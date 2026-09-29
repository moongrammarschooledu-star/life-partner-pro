import { randomInt } from "crypto";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { publishSecurityEvent } from "@/lib/security/event-bus";
import { createFromEvent } from "@/lib/workflow/engine";
import { grantCredit } from "@/lib/finance/credits";
import { grantOverride } from "@/lib/finance/entitlements";
import { notifyReferralRewardGranted } from "@/lib/notifications/events";
import { getPaymentFeatureFlags } from "@/lib/finance/rollout";
import type { ReferralQualifyingEvent } from "@prisma/client";

// STEP 27 §35-43 — referral program. Confirmed zero prior art in this
// codebase before this STEP.

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I — avoids ambiguous codes

function randomSuffix(length = 4): string {
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  return out;
}

function slugify(name: string): string {
  const cleaned = name.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return (cleaned || "MEMBER").slice(0, 12);
}

// Spec §35 — "do not use predictable referral codes": a readable slug alone
// would be guessable, so an unpredictable crypto-random suffix is always
// appended, and the whole code is re-rolled on the rare unique-constraint
// collision rather than ever falling back to something predictable.
export async function generateReferralCode(profileId: string, programId: string): Promise<string> {
  const profile = await prisma.profile.findUnique({ where: { id: profileId }, select: { fullName: true, profileCode: true } });
  const base = slugify(profile?.fullName ?? profile?.profileCode ?? "MEMBER");

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = `LPP-${base}-${randomSuffix()}`;
    try {
      const created = await prisma.referralCode.create({ data: { code, programId, profileId } });
      return created.code;
    } catch (error) {
      if (!isUniqueConstraintViolation(error) || attempt === 4) throw error;
    }
  }
  throw new Error("Could not generate a unique referral code.");
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
}

export async function resolveReferralCode(code: string) {
  const referralCode = await prisma.referralCode.findUnique({ where: { code: code.trim().toUpperCase() }, include: { program: true } });
  if (!referralCode || !referralCode.active) return null;
  if (referralCode.program.status !== "ACTIVE") return null;
  return referralCode;
}

// Called at registration. Rejects self-referral outright — a referee can
// never redeem their own code.
export async function linkReferral(refereeProfileId: string, code: string) {
  // STEP 27 §61 — kill switch: existing linked referrals/rewards are
  // untouched; only NEW linking is paused while disabled.
  if (!(await getPaymentFeatureFlags()).referralsEnabled) throw new Error("The referral program is temporarily unavailable.");
  const referralCode = await resolveReferralCode(code);
  if (!referralCode) throw new Error("Invalid or inactive referral code.");
  if (referralCode.profileId === refereeProfileId) throw new Error("You cannot use your own referral code.");

  const existing = await prisma.referral.findUnique({ where: { refereeProfileId } });
  if (existing) throw new Error("A referral has already been recorded for this account.");

  const referral = await prisma.referral.create({
    data: {
      referralCodeId: referralCode.id,
      programId: referralCode.programId,
      referrerProfileId: referralCode.profileId,
      refereeProfileId,
      status: "LINKED",
      linkedAt: new Date(),
    },
  });
  await prisma.referralEvent.create({ data: { referralId: referral.id, eventType: "LINKED", detail: { code: referralCode.code } } });
  await writeAudit({ action: "REFERRAL_CREATED", targetProfileId: refereeProfileId, meta: { referralId: referral.id, referrerProfileId: referral.referrerProfileId } });
  return referral;
}

// Called from the payment webhook's activateSubscription call site, or a
// verification-complete hook, whichever matches the program's configured
// qualifyingEvent.
export async function evaluateQualifyingEvent(refereeProfileId: string, eventType: ReferralQualifyingEvent) {
  const referral = await prisma.referral.findUnique({ where: { refereeProfileId }, include: { program: true } });
  if (!referral || referral.status !== "LINKED") return null;
  if (referral.program.qualifyingEvent !== eventType) return null;

  const updated = await prisma.referral.update({ where: { id: referral.id }, data: { status: "QUALIFIED", qualifiedAt: new Date() } });
  await prisma.referralEvent.create({ data: { referralId: referral.id, eventType: "QUALIFYING_EVENT_MET", detail: { qualifyingEvent: eventType } } });
  await writeAudit({ action: "REFERRAL_QUALIFIED", targetProfileId: refereeProfileId, meta: { referralId: referral.id } });

  await runFraudCheck(referral.id);
  return updated;
}

// STEP 24 integration point — publishes a security event and moves the
// referral to REFERRAL_REVIEW_REQUIRED rather than auto-rejecting or
// auto-accusing; a human resolves it. Self-referral is already blocked
// outright at linkReferral(), so this focuses on signals that ARE
// ambiguous enough to need a human: shared device/IP between referrer and
// referee, and referral velocity exceeding the program's configured limit.
export async function runFraudCheck(referralId: string): Promise<boolean> {
  const referral = await prisma.referral.findUnique({ where: { id: referralId }, include: { program: true } });
  if (!referral || referral.status !== "QUALIFIED") return false;

  const flags: string[] = [];

  const [referrerIps, refereeIps] = await Promise.all([
    prisma.profileSession.findMany({ where: { profileId: referral.referrerProfileId, ipAddress: { not: null } }, select: { ipAddress: true } }),
    prisma.profileSession.findMany({ where: { profileId: referral.refereeProfileId, ipAddress: { not: null } }, select: { ipAddress: true } }),
  ]);
  const referrerIpSet = new Set(referrerIps.map((s) => s.ipAddress));
  if (refereeIps.some((s) => s.ipAddress && referrerIpSet.has(s.ipAddress))) flags.push("SHARED_DEVICE_OR_IP");

  if (referral.program.maxReferralsPerPeriod && referral.program.periodDays) {
    const windowStart = new Date(Date.now() - referral.program.periodDays * 86_400_000);
    const recentCount = await prisma.referral.count({ where: { referrerProfileId: referral.referrerProfileId, programId: referral.programId, createdAt: { gte: windowStart } } });
    if (recentCount > referral.program.maxReferralsPerPeriod) flags.push("VELOCITY_LIMIT_EXCEEDED");
  }

  if (flags.length === 0) return true; // no fraud signal — caller proceeds to grantReward

  await prisma.referral.update({ where: { id: referralId }, data: { status: "REFERRAL_REVIEW_REQUIRED", fraudFlags: flags } });
  await prisma.referralEvent.create({ data: { referralId, eventType: "FRAUD_CHECK_RUN", detail: { flags } } });
  await publishSecurityEvent({ eventType: "REFERRAL_ABUSE_SUSPECTED", profileId: referral.referrerProfileId, source: "referral-service", idempotencyKey: `referral-fraud:${referralId}` });
  await createFromEvent({
    eventName: "REFERRAL_ABUSE_SUSPECTED",
    dedupKey: `REFERRAL_REVIEW:${referralId}`,
    resourceType: "REFERRAL",
    resourceId: referralId,
    taskType: "REFERRAL_REVIEW",
    title: "Referral flagged for eligibility/fraud review",
  });
  return false;
}

// A human admin resolves a REFERRAL_REVIEW_REQUIRED case back to QUALIFIED
// (then grantReward runs) or to REJECTED.
export async function resolveReferralReview(actorId: string, referralId: string, decision: "QUALIFIED" | "REJECTED") {
  const referral = await prisma.referral.findUnique({ where: { id: referralId } });
  if (!referral || referral.status !== "REFERRAL_REVIEW_REQUIRED") throw new Error("This referral is not pending review.");
  const updated = await prisma.referral.update({ where: { id: referralId }, data: { status: decision } });
  await writeAudit({ action: decision === "REJECTED" ? "REFERRAL_REVERSED" : "REFERRAL_QUALIFIED", adminId: actorId, meta: { referralId, decision } });
  if (decision === "QUALIFIED") await grantReward(referralId);
  return updated;
}

// Dispatches the configured reward once a referral is genuinely QUALIFIED
// (fraud-check passed, or a human cleared the review).
export async function grantReward(referralId: string) {
  const referral = await prisma.referral.findUnique({ where: { id: referralId }, include: { program: true } });
  if (!referral || referral.status !== "QUALIFIED") return null;
  const { program } = referral;

  if (program.maxRewardsPerReferrer) {
    const existingRewards = await prisma.referralReward.count({ where: { referral: { referrerProfileId: referral.referrerProfileId, programId: program.id }, status: "GRANTED" } });
    if (existingRewards >= program.maxRewardsPerReferrer) {
      await prisma.referral.update({ where: { id: referralId }, data: { status: "EXPIRED" } });
      return null;
    }
  }

  const reward = await prisma.referralReward.create({
    data: { referralId, beneficiaryProfileId: referral.referrerProfileId, rewardType: program.rewardType, rewardConfig: program.rewardConfig as object, status: "PENDING" },
  });

  const config = program.rewardConfig as Record<string, unknown>;
  if (program.rewardType === "FREE_DAYS") {
    const days = Number(config.days ?? 0);
    if (days > 0) {
      const subscription = await prisma.subscription.findFirst({ where: { profileId: referral.referrerProfileId, status: { in: ["ACTIVE", "TRIAL", "GRACE_PERIOD"] } } });
      if (subscription && subscription.endDate) {
        const extended = new Date(subscription.endDate.getTime() + days * 86_400_000);
        await prisma.subscription.update({ where: { id: subscription.id }, data: { endDate: extended, renewalDate: extended } });
      }
    }
  } else if (program.rewardType === "CREDIT") {
    const amountMinor = Number(config.creditMinor ?? 0);
    const currencyCode = String(config.currencyCode ?? "PKR");
    if (amountMinor > 0) await grantCredit({ profileId: referral.referrerProfileId, currencyCode, amountMinor, reason: "Referral reward", referenceType: "REFERRAL_REWARD", referenceId: reward.id });
  } else if (program.rewardType === "FEATURE_UNLOCK" || program.rewardType === "DISCOUNT") {
    const featureKey = String(config.featureKey ?? "");
    const days = Number(config.days ?? 30);
    if (featureKey) {
      await grantOverride(null, { profileId: referral.referrerProfileId, featureKey, overrideType: "GRANT", reason: "Referral reward", expiresAt: new Date(Date.now() + days * 86_400_000) });
    }
  } else if (program.rewardType === "COUPON") {
    const discountValue = Number(config.discountValue ?? 0);
    await prisma.coupon.create({
      data: {
        discountCode: await nextSequenceCode("DISC"),
        code: `REF${randomSuffix(6)}`,
        discountType: (config.discountType as never) ?? "PERCENTAGE",
        discountValue,
        perUserLimit: 1,
        active: true,
      },
    });
  }
  // POINTS is intentionally not dispatched to anything today — no points
  // ledger exists in this codebase; a program configured with POINTS is
  // accepted (spec-compliant enum value) but has no real effect until a
  // points system is built. Disclosed limitation, not a silent failure —
  // the reward row stays PENDING rather than being marked GRANTED.
  if (program.rewardType === "POINTS") return reward;

  const granted = await prisma.referralReward.update({ where: { id: reward.id }, data: { status: "GRANTED", grantedAt: new Date() } });
  await prisma.referralRewardTransaction.create({ data: { rewardId: reward.id, action: "GRANTED", detail: { rewardType: program.rewardType } } });
  await prisma.referral.update({ where: { id: referralId }, data: { status: "REWARDED", rewardedAt: new Date() } });
  await writeAudit({ action: "REFERRAL_REWARDED", targetProfileId: referral.referrerProfileId, meta: { referralId, rewardId: reward.id, rewardType: program.rewardType } });
  await notifyReferralRewardGranted(referral.referrerProfileId);
  return granted;
}

// STEP 27 §43 — privacy: only aggregate counts ever reach the referrer.
// The referee's identity is never selected into this response.
export async function getReferralSummary(profileId: string) {
  const referrals = await prisma.referral.findMany({ where: { referrerProfileId: profileId }, include: { rewards: true } });
  const totalReferred = referrals.length;
  const qualified = referrals.filter((r) => ["QUALIFIED", "REWARDED"].includes(r.status)).length;
  const rewarded = referrals.filter((r) => r.status === "REWARDED").length;
  const pendingRewardValue = referrals.flatMap((r) => r.rewards).filter((r) => r.status === "PENDING").length;
  return { totalReferred, qualified, rewarded, pendingRewardValue };
}
