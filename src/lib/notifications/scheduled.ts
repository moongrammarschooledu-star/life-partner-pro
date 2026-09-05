import { prisma } from "@/lib/prisma";
import { notifyMeetingReminder, notifyFollowupReminder, notifyOverdueFollowUp, notifyProposalPendingReminder } from "@/lib/notifications/events";

const MINUTES = 60 * 1000;

// "Still awaiting a response" per the ProposalStatus lifecycle (spec §23's
// "pending proposal" reminder) — at least one side hasn't submitted an
// interested/not-interested response yet.
const AWAITING_RESPONSE_STATUSES = ["WAITING_FOR_PROFILE_A", "WAITING_FOR_PROFILE_B", "BOTH_REVIEWING"] as const;

export interface ScheduledRunResult {
  meetingReminders24h: number;
  meetingReminders2h: number;
  followUpReminders: number;
  overdueFollowUpAlerts: number;
  pendingProposalReminders: number;
}

// Idempotent and safe to call repeatedly (manually or via Vercel Cron) — a
// 15-minute ±15-minute window around each target time means a tick never
// double-fires or skips a reminder (spec §24 "do not spam").
export async function runScheduledNotifications(): Promise<ScheduledRunResult> {
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  const now = new Date();
  const result: ScheduledRunResult = {
    meetingReminders24h: 0,
    meetingReminders2h: 0,
    followUpReminders: 0,
    overdueFollowUpAlerts: 0,
    pendingProposalReminders: 0,
  };

  if (settings?.meetingReminder24hEnabled ?? true) {
    result.meetingReminders24h = await sendMeetingReminders(now, 24 * 60, "reminder24hSentAt", "24H");
  }
  if (settings?.meetingReminder2hEnabled ?? true) {
    result.meetingReminders2h = await sendMeetingReminders(now, 2 * 60, "reminder2hSentAt", "2H");
  }
  if (settings?.followUpReminderEnabled ?? true) {
    result.followUpReminders = await sendFollowUpReminders(now);
    result.overdueFollowUpAlerts = await sendOverdueFollowUpAlerts(now);
  }
  result.pendingProposalReminders = await sendPendingProposalReminders(now, settings?.pendingProposalReminderDays ?? 3);

  return result;
}

async function sendMeetingReminders(now: Date, minutesBefore: number, guardField: "reminder24hSentAt" | "reminder2hSentAt", window: "24H" | "2H") {
  const target = new Date(now.getTime() + minutesBefore * MINUTES);
  const windowStart = new Date(target.getTime() - 15 * MINUTES);
  const windowEnd = new Date(target.getTime() + 15 * MINUTES);

  const meetings = await prisma.meeting.findMany({
    where: {
      scheduledAt: { gte: windowStart, lte: windowEnd },
      [guardField]: null,
      status: { in: ["REQUESTED", "SCHEDULED", "CONFIRMED"] },
    },
    include: { proposal: { select: { id: true, profileAId: true, profileBId: true } } },
  });

  for (const meeting of meetings) {
    await notifyMeetingReminder(meeting.proposal.profileAId, meeting.proposal.profileBId, meeting.proposal.id, window);
    await prisma.meeting.update({ where: { id: meeting.id }, data: { [guardField]: now } });
  }
  return meetings.length;
}

async function sendFollowUpReminders(now: Date) {
  const windowStart = new Date(now.getTime() - 15 * MINUTES);
  const dueToday = await prisma.followUp.findMany({
    where: { status: "PENDING", dueDate: { lte: now }, reminderSentAt: null },
    select: { id: true, profileId: true, dueDate: true },
  });
  // Only fire once the due date has actually arrived within a reasonable
  // window of "now" on this tick — avoids re-sending for very old overdue
  // rows every single cron tick (those are instead surfaced to admins via
  // sendOverdueFollowUpAlerts below).
  const eligible = dueToday.filter((f) => f.dueDate >= windowStart);
  for (const followUp of eligible) {
    await notifyFollowupReminder(followUp.profileId);
    await prisma.followUp.update({ where: { id: followUp.id }, data: { reminderSentAt: now } });
  }
  return eligible.length;
}

async function sendOverdueFollowUpAlerts(now: Date) {
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * MINUTES);
  const overdue = await prisma.followUp.findMany({
    where: { status: "PENDING", dueDate: { lt: oneDayAgo } },
    select: { id: true, profileId: true },
  });
  for (const followUp of overdue) {
    await notifyOverdueFollowUp(followUp.profileId, followUp.id);
  }
  return overdue.length;
}

async function sendPendingProposalReminders(now: Date, reminderAfterDays: number) {
  const threshold = new Date(now.getTime() - reminderAfterDays * 24 * 60 * MINUTES);
  const cooldown = new Date(now.getTime() - reminderAfterDays * 24 * 60 * MINUTES);

  const proposals = await prisma.proposal.findMany({
    where: {
      status: { in: [...AWAITING_RESPONSE_STATUSES] },
      updatedAt: { lte: threshold },
      OR: [{ lastPendingReminderAt: null }, { lastPendingReminderAt: { lte: cooldown } }],
    },
    select: { id: true, profileAId: true, profileBId: true },
  });

  for (const proposal of proposals) {
    await notifyProposalPendingReminder(proposal);
    await prisma.proposal.update({ where: { id: proposal.id }, data: { lastPendingReminderAt: now } });
  }
  return proposals.length;
}
