import { prisma } from "@/lib/prisma";
import { hasActiveHold } from "@/lib/privacy/data-hold";

// STEP 30 - engagement data retention, plugged into the STEP 13 retention policy table (categories ENGAGEMENT_EVENT_DATA and
// ENGAGEMENT_FEEDBACK_DATA). There is NO built-in period: with no active admin-created policy for a category nothing is swept
// (absent policy = keep; legal retention periods are never guessed). A person under a legal hold is skipped.
//   ENGAGEMENT_EVENT_DATA    - old events, and finished reminders / workflow runs, are deleted. Daily snapshots (counts only) are kept.
//   ENGAGEMENT_FEEDBACK_DATA - old feedback is anonymised (text removed) or deleted per the policy's action.

export interface EngagementRetentionResult {
  eventsDeleted: number;
  remindersDeleted: number;
  runsDeleted: number;
  feedbackAnonymized: number;
  feedbackDeleted: number;
  skippedHold: number;
}

const BATCH = 1000;

export async function sweepEngagementRetention(now: Date = new Date()): Promise<EngagementRetentionResult> {
  const result: EngagementRetentionResult = { eventsDeleted: 0, remindersDeleted: 0, runsDeleted: 0, feedbackAnonymized: 0, feedbackDeleted: 0, skippedHold: 0 };

  const eventPolicy = await prisma.retentionPolicy.findUnique({ where: { category: "ENGAGEMENT_EVENT_DATA" } });
  if (eventPolicy?.isActive && eventPolicy.retentionDays > 0) {
    const cutoff = new Date(now.getTime() - eventPolicy.retentionDays * 86_400_000);
    const events = await prisma.engagementEvent.findMany({ where: { occurredAt: { lt: cutoff } }, select: { id: true, profileId: true }, take: BATCH });
    const held = new Map<string, boolean>();
    const deletable: string[] = [];
    for (const e of events) {
      if (!held.has(e.profileId)) held.set(e.profileId, await hasActiveHold({ profileId: e.profileId }));
      if (held.get(e.profileId)) result.skippedHold++;
      else deletable.push(e.id);
    }
    if (deletable.length) result.eventsDeleted = (await prisma.engagementEvent.deleteMany({ where: { id: { in: deletable } } })).count;
    // finished reminders and runs follow the same window (open ones are never removed)
    result.remindersDeleted = (await prisma.engagementReminder.deleteMany({ where: { createdAt: { lt: cutoff }, state: { notIn: ["SCHEDULED", "ELIGIBLE"] } } })).count;
    result.runsDeleted = (await prisma.engagementWorkflowRun.deleteMany({ where: { startedAt: { lt: cutoff }, status: { not: "ACTIVE" } } })).count;
    await prisma.retentionActionLog.create({
      data: { category: "ENGAGEMENT_EVENT_DATA", recordType: "EngagementEvent", recordId: "batch", action: eventPolicy.action, outcome: "APPLIED", detail: JSON.stringify({ events: result.eventsDeleted, reminders: result.remindersDeleted, runs: result.runsDeleted, skippedHold: result.skippedHold }) },
    });
  }

  const fbPolicy = await prisma.retentionPolicy.findUnique({ where: { category: "ENGAGEMENT_FEEDBACK_DATA" } });
  if (fbPolicy?.isActive && fbPolicy.retentionDays > 0 && (fbPolicy.action === "ANONYMIZE" || fbPolicy.action === "DELETE")) {
    const cutoff = new Date(now.getTime() - fbPolicy.retentionDays * 86_400_000);
    const due = await prisma.engagementFeedback.findMany({ where: { createdAt: { lt: cutoff }, ...(fbPolicy.action === "ANONYMIZE" ? { message: { not: "Removed" } } : {}) }, select: { id: true, profileId: true }, take: BATCH });
    for (const f of due) {
      if (await hasActiveHold({ profileId: f.profileId })) {
        result.skippedHold++;
        continue;
      }
      if (fbPolicy.action === "DELETE") {
        await prisma.engagementFeedback.delete({ where: { id: f.id } });
        result.feedbackDeleted++;
      } else {
        await prisma.engagementFeedback.update({ where: { id: f.id }, data: { message: "Removed", subject: null, internalNote: null } });
        result.feedbackAnonymized++;
      }
    }
    await prisma.retentionActionLog.create({
      data: { category: "ENGAGEMENT_FEEDBACK_DATA", recordType: "EngagementFeedback", recordId: "batch", action: fbPolicy.action, outcome: "APPLIED", detail: JSON.stringify({ anonymized: result.feedbackAnonymized, deleted: result.feedbackDeleted }) },
    });
  }
  return result;
}

export async function safeSweepEngagementRetention(): Promise<EngagementRetentionResult | null> {
  try {
    return await sweepEngagementRetention();
  } catch (error) {
    console.error("[engagement] retention sweep failed", error instanceof Error ? error.message : "unknown");
    return null;
  }
}
