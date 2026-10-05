import { prisma } from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { getServerConfig } from "@/lib/config/server-config";
import { evaluateQualifyingEvent, grantReward, linkReferral } from "@/lib/referrals/referral-service";
import { engagementAudit } from "@/lib/engagement/audit";
import { ENGAGEMENT_FLAGS } from "@/lib/engagement/constants";
import { tapEngagement } from "@/lib/engagement/tap";
import type { ReferralQualifyingEvent, ReferralStatus } from "@prisma/client";

// STEP 30 - referral growth on top of the STEP 27 referral service (which owns codes, linking, qualification, fraud check and
// reward grants and is NOT duplicated here). This file adds:
//   1. a shareable link and a per-referral history for the referrer with NEUTRAL status wording and a masked referee,
//   2. capture of a referral code at registration (the response never says whether a code was valid),
//   3. the qualifying-event hook (registration / verification / payment) that, ONLY when loyalty is switched on, grants the
//      reward after a clean fraud check. A flagged referral is never described to the referrer as fraud: it reads
//      "Under routine review" and a human decides.
// The referrer never sees who they referred: no name, contact, profile code, status of that person, nor their activity.

export const REFERRAL_STATUS_LABELS: Record<ReferralStatus, { EN: string; UR: string }> = {
  PENDING: { EN: "Link recorded", UR: "لنک درج ہو گیا" },
  LINKED: { EN: "Joined", UR: "شامل ہو گئے" },
  QUALIFIED: { EN: "Requirement met", UR: "شرط پوری ہو گئی" },
  REWARDED: { EN: "Reward granted", UR: "انعام دے دیا گیا" },
  REFERRAL_REVIEW_REQUIRED: { EN: "Under routine review", UR: "معمول کی جانچ میں" },
  REJECTED: { EN: "Not eligible for a reward", UR: "انعام کے لیے اہل نہیں" },
  EXPIRED: { EN: "Closed", UR: "بند" },
};

export function referralShareLink(code: string): string {
  const base = (getServerConfig().appUrl ?? "").replace(/\/+$/, "");
  return `${base}/register?ref=${encodeURIComponent(code)}`;
}

export async function getReferralOverview(profileId: string) {
  const [codes, referrals] = await Promise.all([
    prisma.referralCode.findMany({ where: { profileId, active: true }, include: { program: { select: { name: true, status: true } } } }),
    prisma.referral.findMany({ where: { referrerProfileId: profileId }, orderBy: { createdAt: "asc" }, take: 200, select: { id: true, status: true, createdAt: true, rewards: { select: { status: true, rewardType: true } } } }),
  ]);
  const history = referrals.map((r, i) => ({
    label: `Referred member ${i + 1}`, // the only identifier the referrer ever gets
    status: r.status,
    statusLabel: REFERRAL_STATUS_LABELS[r.status],
    date: r.createdAt.toISOString().slice(0, 10),
    reward: r.rewards[0] ? { type: r.rewards[0].rewardType, status: r.rewards[0].status === "GRANTED" ? "Granted" : "Pending" } : null,
  }));
  return {
    codes: codes.map((c) => ({ code: c.code, program: c.program.name, active: c.program.status === "ACTIVE", shareLink: referralShareLink(c.code) })),
    history: history.reverse(),
    summary: {
      totalReferred: referrals.length,
      qualified: referrals.filter((r) => ["QUALIFIED", "REWARDED"].includes(r.status)).length,
      rewarded: referrals.filter((r) => r.status === "REWARDED").length,
      underReview: referrals.filter((r) => r.status === "REFERRAL_REVIEW_REQUIRED").length,
    },
    note: "You never see who used your code. Rewards depend on the program rules, and some referrals are checked by our team before a reward is given.",
  };
}

// Called right after a profile is created. Never throws and never reveals whether the code was valid.
export async function captureRegistrationReferral(refereeProfileId: string, rawCode: unknown): Promise<void> {
  try {
    if (typeof rawCode !== "string") return;
    const code = rawCode.trim().toUpperCase();
    if (!/^[A-Z0-9-]{6,40}$/.test(code)) return;
    const referral = await linkReferral(refereeProfileId, code);
    await tapEngagement({ profileId: referral.referrerProfileId, type: "REFERRAL_CREATED", sourceKey: referral.id, refType: "REFERRAL", refId: referral.id });
    await processReferralQualifyingEvent(refereeProfileId, "REGISTRATION");
  } catch {
    // an invalid, inactive, self-owned or already-used code is silently ignored: the registration response must not leak anything
  }
}

// The single entry for "a referred person reached a milestone". Reward granting is OFF unless engagement.loyalty.enabled is on,
// which keeps the existing STEP 27 behaviour exactly as it was by default.
export async function processReferralQualifyingEvent(refereeProfileId: string, eventType: ReferralQualifyingEvent): Promise<void> {
  try {
    const qualified = await evaluateQualifyingEvent(refereeProfileId, eventType);
    if (!qualified) return;
    if (!(await isFeatureEnabled(ENGAGEMENT_FLAGS.master)) || !(await isFeatureEnabled(ENGAGEMENT_FLAGS.loyalty))) return;
    const fresh = await prisma.referral.findUnique({ where: { id: qualified.id }, select: { id: true, status: true, referrerProfileId: true } });
    if (!fresh || fresh.status !== "QUALIFIED") return; // flagged for review (or already settled): a human decides, nothing is granted here
    const reward = await grantReward(fresh.id);
    if (reward) {
      await tapEngagement({ profileId: fresh.referrerProfileId, type: "REFERRAL_REWARDED", sourceKey: fresh.id, refType: "REFERRAL", refId: fresh.id });
      await engagementAudit({ action: "ENGAGEMENT_REFERRAL_ACTION", targetProfileId: fresh.referrerProfileId, resource: "referral", resourceId: fresh.id, after: { event: eventType, granted: true } });
    }
  } catch (error) {
    console.error("[engagement] referral qualification failed", error instanceof Error ? error.message : "error");
  }
}
