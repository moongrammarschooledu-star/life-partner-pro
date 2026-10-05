import { prisma } from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { hasActiveRestriction } from "@/lib/profile-restrictions";
import { sendNotification } from "@/lib/notifications/notification-service";
import { engagementAudit } from "@/lib/engagement/audit";
import { ENGAGEMENT_FLAGS, ENGAGEMENT_NOTIFICATION_TYPES, REENGAGEMENT_KINDS, REMINDER_NOTIFICATION, type ReminderKind } from "@/lib/engagement/constants";
import { DEFAULT_THRESHOLDS, profileMayReceiveEngagement, stillNeeded } from "@/lib/engagement/eligibility";
import { decideFrequency, isWithinQuietHours, nextQuietHoursEnd } from "@/lib/engagement/preflight-core";
import { loadEngagementSnapshot } from "@/lib/engagement/read-model";
import { effectiveLimits, getEngagementPreference, getEngagementSettings } from "@/lib/engagement/settings";
import type { ReengagementState } from "@prisma/client";

// STEP 30 — the ONE path by which an engagement message reaches an applicant. Every reminder, whether created by a workflow,
// a sweep or a staff member, is delivered here, and the gate below runs before anything is sent. Order (first failure wins):
//
//   flags -> reminder still open -> profile may receive messages -> account restrictions -> applicant switches
//   (reminders / re-engagement / feedback) -> notification-channel preferences -> suppression -> still needed? ->
//   frequency + attempt limits -> quiet hours -> send via sendNotification (which applies per-channel consent,
//   channel enable, templates and the STEP 25 policy engine)
//
// Outcomes: SENT, DEFERRED (stays SCHEDULED with a later dueAt), or a terminal state (CANCELLED / OPTED_OUT / SUPPRESSED /
// EXPIRED). Missing information fails closed (the message is NOT sent).

export interface DeliverOutcome {
  state: ReengagementState | "DEFERRED";
  note: string;
}

const FOLLOWUP_ATTEMPT_KINDS: ReminderKind[] = ["PROPOSAL_PENDING", "MEETING_UNCONFIRMED", "FOLLOWUP_OVERDUE", "VERIFICATION_STALLED"];
const HOUR = 3_600_000;

export async function deliverReminder(reminderId: string, now: Date = new Date()): Promise<DeliverOutcome> {
  const r = await prisma.engagementReminder.findUnique({ where: { id: reminderId } });
  if (!r) return { state: "CANCELLED", note: "NOT_FOUND" };
  if (r.state !== "SCHEDULED" && r.state !== "ELIGIBLE") return { state: r.state, note: "ALREADY_FINAL" };
  const kind = r.kind as ReminderKind;

  const finish = async (state: ReengagementState, note: string): Promise<DeliverOutcome> => {
    const final = state === "SENT" || state === "COMPLETED" || state === "RESPONDED";
    await prisma.engagementReminder.update({
      where: { id: r.id },
      data: { state, ...(state === "SENT" ? { sentAt: now } : {}), ...(!final ? { cancelledAt: now, cancelReason: note.slice(0, 120) } : {}) },
    });
    return { state, note };
  };
  const defer = async (until: Date, note: string): Promise<DeliverOutcome> => {
    await prisma.engagementReminder.update({ where: { id: r.id }, data: { dueAt: until, cancelReason: note.slice(0, 120) } });
    return { state: "DEFERRED", note };
  };

  // 1. flags (fail closed: with a flag off the reminder is simply not sent and stays scheduled)
  if (!(await isFeatureEnabled(ENGAGEMENT_FLAGS.master))) return { state: "DEFERRED", note: "ENGAGEMENT_OFF" };
  const isReengagement = REENGAGEMENT_KINDS.includes(kind);
  if (isReengagement && !(await isFeatureEnabled(ENGAGEMENT_FLAGS.reengagement))) return { state: "DEFERRED", note: "REENGAGEMENT_OFF" };
  if (kind === "FEEDBACK_REQUEST" && !(await isFeatureEnabled(ENGAGEMENT_FLAGS.feedback))) return { state: "DEFERRED", note: "FEEDBACK_OFF" };

  // 2. the applicant and their account
  const snapshot = await loadEngagementSnapshot(r.profileId, now);
  if (!snapshot) return finish("CANCELLED", "PROFILE_NOT_FOUND");
  const may = profileMayReceiveEngagement(snapshot);
  if (!may.ok) return finish("CANCELLED", may.reason ?? "PROFILE_STATUS");
  const [restrictedComms, restrictedFull, restrictedLogin] = await Promise.all([
    hasActiveRestriction(r.profileId, "COMMUNICATION_RESTRICTED" as never),
    hasActiveRestriction(r.profileId, "FULL_ACCOUNT_RESTRICTED" as never),
    hasActiveRestriction(r.profileId, "LOGIN_RESTRICTED" as never),
  ]);
  if (restrictedComms || restrictedFull || restrictedLogin) return finish("SUPPRESSED", "ACCOUNT_RESTRICTION"); // the reason is never put in a message

  // 3. the applicant's own switches
  const [pref, state, notifPref, settings] = await Promise.all([
    getEngagementPreference(r.profileId),
    prisma.engagementProfileState.findUnique({ where: { profileId: r.profileId }, select: { reengagementOptOut: true } }),
    prisma.notificationPreference.findUnique({ where: { profileId: r.profileId } }),
    getEngagementSettings(),
  ]);
  if (pref && pref.remindersEnabled === false) return finish("OPTED_OUT", "REMINDERS_OFF");
  if (isReengagement && (pref?.reengagementEnabled === false || state?.reengagementOptOut)) return finish("OPTED_OUT", "REENGAGEMENT_OFF");
  if (kind === "FEEDBACK_REQUEST" && pref?.feedbackRequestsEnabled === false) return finish("OPTED_OUT", "FEEDBACK_REQUESTS_OFF");
  if (notifPref && !notifPref.inAppFollowUpReminders && !notifPref.emailFollowUpReminders && !notifPref.smsFollowUpReminders && !notifPref.whatsappFollowUpReminders) return finish("SUPPRESSED", "ALL_REMINDER_CHANNELS_OFF");

  // 4. suppression (an ALL-scope suppression on the profile ends engagement contact entirely)
  const suppressed = await prisma.communicationSuppression.findFirst({ where: { profileId: r.profileId, status: "ACTIVE", scope: "ALL" }, select: { id: true } });
  if (suppressed) return finish("SUPPRESSED", "SUPPRESSION_ACTIVE");

  // 5. is the thing still open? (never remind about something already done)
  if (!stillNeeded(kind, snapshot, { ...DEFAULT_THRESHOLDS, inactiveAfterDays: settings.inactiveAfterDays })) return finish("CANCELLED", "NO_LONGER_APPLICABLE");

  // 6. frequency + attempt limits (all from admin-editable settings and the applicant's own cap)
  const limits = effectiveLimits(settings, pref);
  const dayAgo = new Date(now.getTime() - 24 * HOUR);
  const weekAgo = new Date(now.getTime() - 7 * 24 * HOUR);
  const [sentToday, reengagementSentThisWeek, lastSame, priorAttempts, legacyReminder] = await Promise.all([
    prisma.notification.count({ where: { recipientProfileId: r.profileId, type: { in: ENGAGEMENT_NOTIFICATION_TYPES }, createdAt: { gte: dayAgo } } }),
    prisma.engagementReminder.count({ where: { profileId: r.profileId, kind: { in: REENGAGEMENT_KINDS }, state: { in: ["SENT", "RESPONDED", "COMPLETED"] }, sentAt: { gte: weekAgo } } }),
    prisma.engagementReminder.findFirst({ where: { profileId: r.profileId, kind: r.kind, state: { in: ["SENT", "RESPONDED", "COMPLETED"] } }, orderBy: { sentAt: "desc" }, select: { sentAt: true } }),
    prisma.engagementReminder.count({ where: { profileId: r.profileId, kind: r.kind, refId: r.refId, state: { in: ["SENT", "RESPONDED", "COMPLETED"] } } }),
    // The existing STEP 9 proposal reminder must not double up with this one.
    kind === "PROPOSAL_PENDING"
      ? prisma.notification.count({ where: { recipientProfileId: r.profileId, type: "PROPOSAL_PENDING_REMINDER", createdAt: { gte: new Date(now.getTime() - settings.reminderMinGapHours * HOUR) } } })
      : Promise.resolve(0),
  ]);
  const maxAttempts = kind === "FEEDBACK_REQUEST" ? 1 : FOLLOWUP_ATTEMPT_KINDS.includes(kind) ? settings.maxFollowupAttempts : settings.maxReengagementAttempts;
  const decision = decideFrequency(
    { sentToday, reengagementSentThisWeek, hoursSinceLastSameKind: lastSame?.sentAt ? (now.getTime() - lastSame.sentAt.getTime()) / HOUR : null, priorAttemptsForKind: priorAttempts, isReengagement },
    { dailyMax: limits.dailyMax, weeklyReengagementMax: settings.maxWeeklyReengagement, minGapHours: settings.reminderMinGapHours, maxAttempts },
  );
  if (!decision.ok) {
    if (decision.action === "EXPIRE") return finish("EXPIRED", decision.reason);
    return defer(new Date(now.getTime() + decision.deferHours * HOUR), decision.reason);
  }
  if (legacyReminder > 0) return defer(new Date(now.getTime() + settings.reminderMinGapHours * HOUR), "LEGACY_REMINDER_RECENT");

  // 7. quiet hours (the applicant's own window, or the admin default); nothing here is time-critical, so it just waits
  if (isWithinQuietHours(now, limits.quiet.timezone, limits.quiet.start, limits.quiet.end)) return defer(nextQuietHoursEnd(now, limits.quiet.timezone, limits.quiet.start, limits.quiet.end), "QUIET_HOURS");

  // 8. send through the standard notification pipeline (channel consent, channel switches, templates, policy engine live there)
  await sendNotification({ profileId: r.profileId, type: REMINDER_NOTIFICATION[kind], data: { relatedProposalId: r.refType === "PROPOSAL" ? (r.refId ?? undefined) : undefined } });
  await prisma.engagementReminder.update({ where: { id: r.id }, data: { state: "SENT", sentAt: now, cancelReason: null } });
  if (isReengagement) {
    await prisma.engagementProfileState.upsert({
      where: { profileId: r.profileId },
      update: { lastReengagementAt: now, reengagementAttempts: { increment: 1 } },
      create: { profileId: r.profileId, lastReengagementAt: now, reengagementAttempts: 1 },
    });
  }
  await engagementAudit({ action: "ENGAGEMENT_REENGAGEMENT_SENT", targetProfileId: r.profileId, resource: "engagement_reminder", resourceId: r.id, after: { kind, attempt: r.attempt } }).catch(() => undefined);
  return { state: "SENT", note: "SENT" };
}
