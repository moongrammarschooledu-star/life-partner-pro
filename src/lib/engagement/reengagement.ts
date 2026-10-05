import { prisma } from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { activityBand, daysSince } from "@/lib/engagement/activity-score";
import { ENGAGEMENT_FLAGS, REMINDER_BATCH_SIZE } from "@/lib/engagement/constants";
import { deliverReminder } from "@/lib/engagement/deliver";
import { NO_CONTACT_PROFILE_STATUSES } from "@/lib/engagement/eligibility";
import { recordEngagementEvent } from "@/lib/engagement/events";
import { getEngagementSettings } from "@/lib/engagement/settings";

// STEP 30 — the time-based detection that nothing in the request path can see: who has gone quiet, whose membership period is
// ending, and which scheduled reminders are due. Runs from the daily tick (Vercel Hobby = one cron per day) or "Run now".
//
// Rules this file enforces:
//  - Only applicants who already have an activity record are swept. Someone with no recorded activity is NOT assumed inactive
//    (missing data fails closed: no message).
//  - An applicant is "eligible" for re-engagement at most once per cooldown window (the event key carries the window number),
//    never beyond the admin-set attempt cap, never after they opted out, never while their account is closed/restricted.
//  - A sweep only RECORDS events. Whether anything is sent is decided by published workflows and, finally, by deliver.ts.

const DAY = 86_400_000;
const SWEEP_BATCH = 500;

export interface SweepResult {
  skipped: boolean;
  classified: number;
  eligible: number;
  membershipExpiring: number;
}

export async function runReengagementSweep(now: Date = new Date()): Promise<SweepResult> {
  if (!(await isFeatureEnabled(ENGAGEMENT_FLAGS.master)) || !(await isFeatureEnabled(ENGAGEMENT_FLAGS.reengagement))) return { skipped: true, classified: 0, eligible: 0, membershipExpiring: 0 };
  const s = await getEngagementSettings();
  const lowCutoff = new Date(now.getTime() - s.lowActivityAfterDays * DAY);
  const bucket = Math.floor(now.getTime() / (s.reengagementCooldownDays * DAY));

  let classified = 0;
  let eligible = 0;

  // Applicants quiet for at least the "low activity" period, oldest first.
  const states = await prisma.engagementProfileState.findMany({
    where: { lastActivityAt: { lt: lowCutoff }, reengagementOptOut: false },
    orderBy: { lastActivityAt: "asc" },
    take: SWEEP_BATCH,
  });
  if (states.length) {
    const profiles = await prisma.profile.findMany({
      where: { id: { in: states.map((x) => x.profileId) }, softDeleted: false, status: { notIn: NO_CONTACT_PROFILE_STATUSES as never } },
      select: { id: true },
    });
    const live = new Set(profiles.map((p) => p.id));
    for (const st of states) {
      if (!live.has(st.profileId) || !st.lastActivityAt) continue;
      const idle = daysSince(st.lastActivityAt, now);
      const band = activityBand(idle, s.lowActivityAfterDays, s.inactiveAfterDays);
      const wanted = band === "INACTIVE" ? "INACTIVE" : band === "LOW_ACTIVITY" ? "LOW_ACTIVITY" : "ACTIVE";
      if (st.activityState !== wanted && st.activityState !== "SUPPRESSED") {
        await prisma.engagementProfileState.update({ where: { id: st.id }, data: { activityState: wanted } });
        classified++;
      }
      if (band !== "INACTIVE") continue;
      // cooldown + attempt cap are checked here too so no event is even recorded for someone who cannot be contacted again
      if (st.reengagementAttempts >= s.maxReengagementAttempts) continue;
      if (st.lastReengagementAt && now.getTime() - st.lastReengagementAt.getTime() < s.reengagementCooldownDays * DAY) continue;
      const a = await recordEngagementEvent({ profileId: st.profileId, type: "INACTIVE_USER", sourceKey: `b${bucket}`, payload: { idleDays: idle ?? 0 }, occurredAt: now });
      const b = await recordEngagementEvent({ profileId: st.profileId, type: "REENGAGEMENT_ELIGIBLE", sourceKey: `b${bucket}`, payload: { idleDays: idle ?? 0 }, occurredAt: now });
      if (a.recorded || b.recorded) {
        eligible++;
        await prisma.engagementProfileState.update({ where: { id: st.id }, data: { activityState: "REENGAGEMENT_ELIGIBLE" } });
      }
    }
  }

  const membershipExpiring = await runMembershipExpirySweep(now);
  return { skipped: false, classified, eligible, membershipExpiring };
}

// Membership periods ending inside the window. One event per subscription (keyed by subscription id and end date, so a renewal
// creates a fresh key but a repeated sweep does not).
export async function runMembershipExpirySweep(now: Date = new Date(), windowDays = 14): Promise<number> {
  const horizon = new Date(now.getTime() + windowDays * DAY);
  const subs = await prisma.subscription.findMany({
    where: { status: { in: ["ACTIVE", "TRIAL"] }, endDate: { gte: now, lte: horizon } },
    select: { id: true, profileId: true, endDate: true },
    orderBy: { endDate: "asc" },
    take: SWEEP_BATCH,
  });
  let n = 0;
  for (const sub of subs) {
    const r = await recordEngagementEvent({
      profileId: sub.profileId, type: "MEMBERSHIP_EXPIRING", sourceKey: `${sub.id}:${sub.endDate?.toISOString().slice(0, 10)}`,
      refType: "SUBSCRIPTION", refId: sub.id, occurredAt: now,
    });
    if (r.recorded) n++;
  }
  return n;
}

// Reminders that are scheduled and due. Each goes through the single preflight gate; a reminder that is not allowed yet is
// pushed to a later time by deliver.ts, one that is no longer needed is cancelled there.
export async function deliverDueReminders(now: Date = new Date(), limit: number = REMINDER_BATCH_SIZE): Promise<{ examined: number; sent: number; deferred: number; closed: number }> {
  if (!(await isFeatureEnabled(ENGAGEMENT_FLAGS.master))) return { examined: 0, sent: 0, deferred: 0, closed: 0 };
  const due = await prisma.engagementReminder.findMany({ where: { state: { in: ["SCHEDULED", "ELIGIBLE"] }, dueAt: { lte: now } }, orderBy: { dueAt: "asc" }, take: limit, select: { id: true } });
  let sent = 0;
  let deferred = 0;
  let closed = 0;
  for (const r of due) {
    try {
      const out = await deliverReminder(r.id, now);
      if (out.state === "SENT") sent++;
      else if (out.state === "DEFERRED") deferred++;
      else closed++;
    } catch (error) {
      console.error("[engagement] reminder delivery failed", error instanceof Error ? error.message : "error");
    }
  }
  return { examined: due.length, sent, deferred, closed };
}
