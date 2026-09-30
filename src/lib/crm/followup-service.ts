import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { HttpError } from "@/lib/http-error";
import { createFromEvent } from "@/lib/workflow/engine";
import { notifyCrmFollowupDue, notifyCrmFollowupOverdue } from "@/lib/notifications/events";
import { touchLastActivity } from "@/lib/crm/crm-record-service";
import type { CrmFollowUpType, CrmFollowUpSlaState, NotificationChannel, FollowUpPriority, FollowUpStatus } from "@prisma/client";

// STEP 28 §26-30 — extends the existing FollowUp model (see schema.prisma;
// this is NOT a parallel follow-up table — the pre-STEP-28 cron/UI/AI-draft/
// report consumers of FollowUp keep working unmodified).

export interface CreateFollowupInput {
  crmRecordId: string;
  profileId: string;
  type: CrmFollowUpType;
  purpose?: string;
  channel?: NotificationChannel;
  dueDate: Date;
  priority?: FollowUpPriority;
  nextAction?: string;
  createdById: string;
}

export async function createFollowup(input: CreateFollowupInput) {
  const followUpCode = await nextSequenceCode("FUP");
  const followUp = await prisma.followUp.create({
    data: {
      followUpCode,
      profileId: input.profileId,
      crmRecordId: input.crmRecordId,
      adminId: input.createdById,
      type: input.type,
      purpose: input.purpose,
      channel: input.channel,
      dueDate: input.dueDate,
      priority: input.priority ?? "MEDIUM",
      nextAction: input.nextAction,
      slaState: "ON_TRACK",
    },
  });
  await prisma.crmRecord.update({ where: { id: input.crmRecordId }, data: { nextFollowupAt: input.dueDate } });
  await touchLastActivity(input.crmRecordId);
  await writeAudit({ action: "CRM_FOLLOWUP_CREATED", adminId: input.createdById, targetProfileId: input.profileId, meta: { followUpId: followUp.id, followUpCode, type: input.type } });
  return followUp;
}

export async function completeFollowup(followUpId: string, actorId: string, outcome?: string) {
  const followUp = await prisma.followUp.findUnique({ where: { id: followUpId } });
  if (!followUp) throw new HttpError(404, "Follow-up not found.");
  if (followUp.status === "COMPLETED") throw new HttpError(409, "This follow-up is already completed.");

  const updated = await prisma.followUp.update({ where: { id: followUpId }, data: { status: "COMPLETED", completedAt: new Date(), outcome, slaState: "EXEMPT" } });
  if (followUp.crmRecordId) await touchLastActivity(followUp.crmRecordId);
  await writeAudit({ action: "CRM_FOLLOWUP_COMPLETED", adminId: actorId, targetProfileId: followUp.profileId, meta: { followUpId, outcome } });
  return updated;
}

export async function reopenFollowup(followUpId: string, actorId: string, newDueDate?: Date) {
  const followUp = await prisma.followUp.findUnique({ where: { id: followUpId } });
  if (!followUp) throw new HttpError(404, "Follow-up not found.");
  return prisma.followUp.update({ where: { id: followUpId }, data: { status: "PENDING", completedAt: null, dueDate: newDueDate ?? followUp.dueDate, slaState: "ON_TRACK" } });
}

// STEP 28 §54 (adapted) — pure classifier mirroring classifyTaskSla's exact
// shape/signature for consistency, against FollowUpReminderConfig's windows
// instead of TaskSlaConfig.
export function classifyFollowupSla(params: { dueDate: Date; status: FollowUpStatus; now?: Date }): CrmFollowUpSlaState {
  if (params.status === "COMPLETED" || params.status === "CANCELLED") return "EXEMPT";
  if (params.status === "ESCALATED") return "BREACHED";
  const now = params.now ?? new Date();
  const remainingMs = params.dueDate.getTime() - now.getTime();
  const DUE_SOON_WINDOW_MS = 4 * 60 * 60 * 1000;
  const OVERDUE_BREACH_WINDOW_MS = 24 * 60 * 60 * 1000; // overdue > 24h is treated as breached, escalation-eligible
  if (remainingMs < -OVERDUE_BREACH_WINDOW_MS) return "BREACHED";
  if (remainingMs < 0) return "OVERDUE";
  if (remainingMs <= DUE_SOON_WINDOW_MS) return "DUE_SOON";
  return "ON_TRACK";
}

// STEP 28 §29 — multi-stage reminder loop, called from the daily tick
// (src/lib/notifications/scheduled.ts). Dedup via FollowUpReminderLog, not a
// mutable array — re-running the sweep never re-sends an already-sent stage.
export async function runFollowupReminderSweep(): Promise<{ sent: number; overdueMarked: number }> {
  const now = new Date();
  const pending = await prisma.followUp.findMany({ where: { status: "PENDING", crmRecordId: { not: null } } });
  let sent = 0;
  let overdueMarked = 0;

  const configs = await prisma.followUpReminderConfig.findMany({ where: { active: true } });
  const configByType = new Map(configs.map((c) => [c.followUpType, c]));

  for (const followUp of pending) {
    const config = followUp.type ? configByType.get(followUp.type) : null;
    const hoursBeforeDueList = config?.hoursBeforeDue ?? [24, 12, 1, 0];

    for (const hoursBeforeDue of hoursBeforeDueList) {
      const fireAt = new Date(followUp.dueDate.getTime() - hoursBeforeDue * 60 * 60 * 1000);
      if (now < fireAt) continue;
      try {
        await prisma.followUpReminderLog.create({ data: { followUpId: followUp.id, hoursBeforeDue } });
      } catch {
        continue; // already sent this stage
      }
      if (followUp.adminId) await notifyCrmFollowupDue(followUp.adminId, followUp.id).catch(() => undefined);
      sent++;
    }

    const newSlaState = classifyFollowupSla({ dueDate: followUp.dueDate, status: followUp.status, now });
    if (newSlaState !== followUp.slaState) {
      await prisma.followUp.update({ where: { id: followUp.id }, data: { slaState: newSlaState } });
      if ((newSlaState === "OVERDUE" || newSlaState === "BREACHED") && followUp.slaState !== "OVERDUE" && followUp.slaState !== "BREACHED") {
        overdueMarked++;
        if (followUp.adminId) await notifyCrmFollowupOverdue(followUp.adminId, followUp.id).catch(() => undefined);
      }
    }
  }
  return { sent, overdueMarked };
}

// STEP 28 §30 — "no response after N days" style automation, driven by the
// existing WorkflowRule table (reused directly — no new automation-config
// infra). A rule's eventName is looked up by convention
// (crm.followup.no_response.<type>); if none is configured/active, nothing fires.
export async function evaluateFollowupAutomation(): Promise<number> {
  const breached = await prisma.followUp.findMany({ where: { status: "PENDING", slaState: "BREACHED", escalatedTaskId: null } });
  let escalated = 0;
  for (const followUp of breached) {
    const eventName = `crm.followup.escalation.${(followUp.type ?? "general").toLowerCase()}`;
    const rule = await prisma.workflowRule.findUnique({ where: { eventName } });
    if (rule && !rule.active) continue;

    const task = await createFromEvent({
      eventName,
      dedupKey: `CRM_FOLLOWUP_ESCALATION:${followUp.id}`,
      resourceType: "FOLLOW_UP",
      resourceId: followUp.id,
      taskType: "CRM_FOLLOWUP_ESCALATION",
      title: `Follow-up ${followUp.followUpCode ?? followUp.id} breached its SLA`,
    });
    if (task) {
      await prisma.followUp.update({ where: { id: followUp.id }, data: { escalatedTaskId: task.id, status: "ESCALATED" } });
      escalated++;
    }
  }
  return escalated;
}
