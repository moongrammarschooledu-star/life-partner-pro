import { prisma } from "@/lib/prisma";
import { safeRate, MIN_SAMPLE_SIZE } from "@/lib/reports/sample-size";
import { ENGAGEMENT_NOTIFICATION_TYPES, SNAPSHOT_METRICS } from "@/lib/engagement/constants";
import type { EngagementEventType } from "@prisma/client";

// STEP 30 - engagement analytics. Everything is an aggregate computed from rows that exist; a rate on fewer than
// MIN_SAMPLE_SIZE people is reported as null with an explanation (never a made-up number). Nothing here is per-person, nothing
// reads the activity score, and none of it measures or predicts marriage outcomes: the funnel stops at "meeting completed".
// Distinct-person counts read at most DISTINCT_CAP people; if a window is larger, the result says "capped".

const DAY = 86_400_000;
const DISTINCT_CAP = 20_000;

export const ANALYTICS_DEFINITIONS = {
  funnel: "People counted once per step if they have at least one matching event in the window. Events are recorded from the day engagement tracking was switched on, so earlier activity is not included.",
  retention: "Day N retention: of the people who registered at least N days ago, the share who signed in on a later day within N days of registering. Only cohorts with enough people show a percentage.",
  reengagement: "Response rate: of re-engagement reminders that were sent, the share where the person then did the thing asked of them. Counted from recorded responses only.",
};

async function distinctPeople(type: EngagementEventType, since: Date): Promise<{ count: number; capped: boolean }> {
  const rows = await prisma.engagementEvent.findMany({ where: { type, occurredAt: { gte: since } }, distinct: ["profileId"], select: { profileId: true }, take: DISTINCT_CAP });
  return { count: rows.length, capped: rows.length >= DISTINCT_CAP };
}

export async function getEngagementOverview(days = 30, now: Date = new Date()) {
  const since = new Date(now.getTime() - days * DAY);
  const [byType, states, reminders, runs, workflows, feedback, announcements, sentNotifs, readNotifs] = await Promise.all([
    prisma.engagementEvent.groupBy({ by: ["type"], where: { occurredAt: { gte: since } }, _count: { type: true } }),
    prisma.engagementProfileState.groupBy({ by: ["activityState"], _count: { activityState: true } }),
    prisma.engagementReminder.groupBy({ by: ["state"], where: { createdAt: { gte: since } }, _count: { state: true } }),
    prisma.engagementWorkflowRun.groupBy({ by: ["status"], where: { startedAt: { gte: since } }, _count: { status: true } }),
    prisma.engagementWorkflow.groupBy({ by: ["status"], _count: { status: true } }),
    prisma.engagementFeedback.groupBy({ by: ["status"], _count: { status: true } }),
    prisma.engagementAnnouncement.groupBy({ by: ["status"], _count: { status: true } }),
    prisma.notification.count({ where: { type: { in: ENGAGEMENT_NOTIFICATION_TYPES }, createdAt: { gte: since } } }),
    prisma.notification.count({ where: { type: { in: ENGAGEMENT_NOTIFICATION_TYPES }, createdAt: { gte: since }, readAt: { not: null } } }),
  ]);
  const sent = reminders.find((r) => r.state === "SENT")?._count.state ?? 0;
  const responded = reminders.find((r) => r.state === "RESPONDED")?._count.state ?? 0;
  const reRate = safeRate(responded, sent + responded);
  return {
    windowDays: days,
    events: Object.fromEntries(byType.map((e) => [e.type, e._count.type])),
    activityStates: Object.fromEntries(states.map((s) => [s.activityState, s._count.activityState])),
    reminders: Object.fromEntries(reminders.map((r) => [r.state, r._count.state])),
    runs: Object.fromEntries(runs.map((r) => [r.status, r._count.status])),
    workflows: Object.fromEntries(workflows.map((w) => [w.status, w._count.status])),
    feedback: Object.fromEntries(feedback.map((f) => [f.status, f._count.status])),
    announcements: Object.fromEntries(announcements.map((a) => [a.status, a._count.status])),
    reengagementResponseRate: reRate,
    reengagementNote: reRate === null ? `Fewer than ${MIN_SAMPLE_SIZE} reminders were sent in this period, so no rate is shown.` : null,
    notifications: { sent: sentNotifs, read: readNotifs, readRate: safeRate(readNotifs, sentNotifs) },
    definitions: ANALYTICS_DEFINITIONS,
  };
}

const FUNNEL: Array<{ key: string; label: string; type: EngagementEventType }> = [
  { key: "registered", label: "Registered", type: "USER_REGISTERED" },
  { key: "profileCompleted", label: "Profile completed", type: "PROFILE_COMPLETED" },
  { key: "profileSubmitted", label: "Profile submitted", type: "PROFILE_SUBMITTED" },
  { key: "verified", label: "Verification completed", type: "VERIFICATION_COMPLETED" },
  { key: "activated", label: "Profile activated", type: "PROFILE_ACTIVATED" },
  { key: "proposalReceived", label: "Received a proposal", type: "PROPOSAL_RECEIVED" },
  { key: "responded", label: "Responded to a proposal", type: "PROPOSAL_RESPONSE_RECEIVED" },
  { key: "meetingCompleted", label: "Completed a meeting", type: "MEETING_COMPLETED" },
];

export async function getEngagementFunnel(days = 90, now: Date = new Date()) {
  const since = new Date(now.getTime() - days * DAY);
  const counts = await Promise.all(FUNNEL.map((f) => distinctPeople(f.type, since)));
  const steps = FUNNEL.map((f, i) => ({
    key: f.key, label: f.label, people: counts[i].count, capped: counts[i].capped,
    // step-to-step rate; null when the previous step is too small to give an honest percentage
    rateFromPrevious: i === 0 ? null : safeRate(counts[i].count, counts[i - 1].count),
  }));
  return { windowDays: days, steps, definition: ANALYTICS_DEFINITIONS.funnel };
}

export async function getRetention(now: Date = new Date()) {
  const regs = await prisma.engagementEvent.findMany({ where: { type: "USER_REGISTERED", occurredAt: { gte: new Date(now.getTime() - 120 * DAY) } }, select: { profileId: true, occurredAt: true }, take: 5000 });
  const logins = regs.length
    ? await prisma.engagementEvent.findMany({ where: { type: "LOGIN", profileId: { in: regs.map((r) => r.profileId) } }, select: { profileId: true, occurredAt: true }, take: 50_000 })
    : [];
  const byProfile = new Map<string, Date[]>();
  for (const l of logins) byProfile.set(l.profileId, [...(byProfile.get(l.profileId) ?? []), l.occurredAt]);
  const retention = [1, 7, 30].map((n) => {
    const cohort = regs.filter((r) => now.getTime() - r.occurredAt.getTime() >= n * DAY);
    const returned = cohort.filter((r) => {
      const day0 = r.occurredAt.toISOString().slice(0, 10);
      return (byProfile.get(r.profileId) ?? []).some((d) => d.toISOString().slice(0, 10) !== day0 && d.getTime() > r.occurredAt.getTime() && d.getTime() - r.occurredAt.getTime() <= n * DAY);
    }).length;
    return { day: n, cohortSize: cohort.length, returned, rate: safeRate(returned, cohort.length) };
  });
  return { retention, definition: ANALYTICS_DEFINITIONS.retention };
}

// Cohorts by registration month only (never by religion, caste, income or any profile attribute).
export async function getCohorts(months = 6, now: Date = new Date()) {
  const definition = "Registration month. Counts people from that month who later reached each step; a percentage needs at least 5 people.";
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  const regs = await prisma.engagementEvent.findMany({ where: { type: "USER_REGISTERED", occurredAt: { gte: start } }, select: { profileId: true, occurredAt: true }, take: 10_000 });
  if (!regs.length) return { cohorts: [], definition };
  const later = await prisma.engagementEvent.findMany({
    where: { profileId: { in: regs.map((r) => r.profileId) }, type: { in: ["PROFILE_COMPLETED", "VERIFICATION_COMPLETED", "PROFILE_ACTIVATED", "PROPOSAL_RESPONSE_RECEIVED"] } },
    select: { profileId: true, type: true }, distinct: ["profileId", "type"], take: 50_000,
  });
  const has = new Map<string, Set<string>>();
  for (const e of later) has.set(e.profileId, (has.get(e.profileId) ?? new Set()).add(e.type));
  const byMonth = new Map<string, string[]>();
  for (const r of regs) {
    const k = r.occurredAt.toISOString().slice(0, 7);
    byMonth.set(k, [...(byMonth.get(k) ?? []), r.profileId]);
  }
  const cohorts = [...byMonth.entries()].sort().map(([month, people]) => {
    const n = (t: string) => people.filter((p) => has.get(p)?.has(t)).length;
    return {
      month, registered: people.length,
      profileCompleted: n("PROFILE_COMPLETED"), verified: n("VERIFICATION_COMPLETED"), activated: n("PROFILE_ACTIVATED"), responded: n("PROPOSAL_RESPONSE_RECEIVED"),
      profileCompletedRate: safeRate(n("PROFILE_COMPLETED"), people.length), verifiedRate: safeRate(n("VERIFICATION_COMPLETED"), people.length),
    };
  });
  return { cohorts, definition };
}

// Delivery + queue health for engagement messages only (no message bodies, no recipients).
export async function getChannelHealth(days = 7, now: Date = new Date()) {
  const since = new Date(now.getTime() - days * DAY);
  const [byChannelStatus, suppressions, optOuts] = await Promise.all([
    prisma.communicationLog.groupBy({ by: ["channel", "deliveryStatus"], where: { notificationType: { in: ENGAGEMENT_NOTIFICATION_TYPES }, createdAt: { gte: since }, isTest: false }, _count: { _all: true } }),
    prisma.communicationSuppression.count({ where: { status: "ACTIVE" } }),
    prisma.engagementProfileState.count({ where: { reengagementOptOut: true } }),
  ]);
  return {
    windowDays: days,
    channels: byChannelStatus.map((r) => ({ channel: r.channel, status: r.deliveryStatus, count: r._count._all })),
    activeSuppressions: suppressions,
    reengagementOptOuts: optOuts,
    note: "In-app delivery is always available. Email, SMS and WhatsApp rows appear only when those providers are configured and enabled. Open and click tracking is intentionally not collected.",
  };
}

// Daily snapshot: counts only, idempotent per (date, metric) so a re-run overwrites rather than duplicates.
const SNAPSHOT_EVENT: Partial<Record<(typeof SNAPSHOT_METRICS)[number], EngagementEventType>> = {
  REGISTERED: "USER_REGISTERED", PROFILE_STARTED: "PROFILE_STARTED", PROFILE_COMPLETED: "PROFILE_COMPLETED", PROFILE_SUBMITTED: "PROFILE_SUBMITTED", VERIFIED: "VERIFICATION_COMPLETED",
  ACTIVATED: "PROFILE_ACTIVATED", PROPOSAL_RECEIVED: "PROPOSAL_RECEIVED", PROPOSAL_RESPONDED: "PROPOSAL_RESPONSE_RECEIVED", MEETING_SCHEDULED: "MEETING_SCHEDULED", MEETING_COMPLETED: "MEETING_COMPLETED", LOGINS: "LOGIN",
};

export async function writeDailySnapshot(day: Date = new Date()): Promise<number> {
  const date = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
  const next = new Date(date.getTime() + DAY);
  let written = 0;
  const put = async (metric: string, value: number) => {
    await prisma.engagementDailySnapshot.upsert({ where: { date_metric_dimension: { date, metric, dimension: "ALL" } }, update: { value }, create: { date, metric, dimension: "ALL", value } });
    written++;
  };
  for (const [metric, type] of Object.entries(SNAPSHOT_EVENT)) {
    await put(metric, await prisma.engagementEvent.count({ where: { type, occurredAt: { gte: date, lt: next } } }));
  }
  await put("ACTIVE_USERS", (await prisma.engagementEvent.findMany({ where: { type: "LOGIN", occurredAt: { gte: date, lt: next } }, distinct: ["profileId"], select: { profileId: true }, take: DISTINCT_CAP })).length);
  await put("REMINDERS_SENT", await prisma.engagementReminder.count({ where: { sentAt: { gte: date, lt: next } } }));
  await put("REMINDERS_CANCELLED", await prisma.engagementReminder.count({ where: { cancelledAt: { gte: date, lt: next } } }));
  await put("REENGAGEMENT_RESPONDED", await prisma.engagementReminder.count({ where: { state: "RESPONDED", updatedAt: { gte: date, lt: next } } }));
  return written;
}

export async function getSnapshotSeries(metric: string, days = 30, now: Date = new Date()) {
  if (!(SNAPSHOT_METRICS as readonly string[]).includes(metric)) return [];
  const since = new Date(now.getTime() - days * DAY);
  const rows = await prisma.engagementDailySnapshot.findMany({ where: { metric, dimension: "ALL", date: { gte: since } }, orderBy: { date: "asc" }, take: 400 });
  return rows.map((r) => ({ date: r.date.toISOString().slice(0, 10), value: r.value }));
}
