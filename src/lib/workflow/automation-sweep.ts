import { prisma } from "@/lib/prisma";
import { escalateTask } from "@/lib/workflow/engine";
import { classifyTaskSla } from "@/lib/workflow/sla";
import { retryWorkflowEvent } from "@/lib/workflow/retry";
import { notifyTaskDueSoon, notifyTaskOverdue } from "@/lib/notifications/events";
import { ACTIVE_TASK_STATUSES } from "@/lib/workflow/status";

const MAX_ESCALATION_LEVEL = 4;
const RETRY_ATTEMPT_CAP = 5;

// STEP 18 §22/§65/§66 — runs once per day inside runDailyTick() (see
// src/lib/ops/scheduler.ts). Two independent jobs, isolated from each other
// so one failing never blocks the other:
//   1. SLA-breach sweep: an overdue open task is auto-escalated — notify-only,
//      never a status/outcome change beyond "needs higher-level review"
//      (spec §23's explicit "never an automatic adverse decision").
//   2. Automation retry: any FAILED WorkflowEvent under the retry cap gets
//      one more attempt; nothing is ever silently dropped (spec §65).
export async function runWorkflowAutomationSweep(): Promise<{ escalated: number; dueSoonNotified: number; overdueNotified: number; retried: number; stillFailed: number }> {
  const now = new Date();

  const openTasks = await prisma.adminTask.findMany({
    where: { status: { in: ACTIVE_TASK_STATUSES }, dueAt: { not: null } },
    select: { id: true, dueAt: true, escalationLevel: true, escalationStatus: true, assignedToId: true, taskCode: true, title: true, taskType: true },
  });

  let escalated = 0;
  let dueSoonNotified = 0;
  let overdueNotified = 0;

  for (const task of openTasks) {
    const bucket = classifyTaskSla({ targetResolutionAt: task.dueAt, warningAt: null, escalated: task.escalationStatus === "ESCALATED", paused: false, now });

    if (bucket === "OVERDUE") {
      if (task.assignedToId) {
        await notifyTaskOverdue(task.assignedToId, task.taskCode ?? task.id, task.title ?? task.taskType);
        overdueNotified++;
      }
      if (task.escalationStatus !== "ESCALATED" && task.escalationLevel < MAX_ESCALATION_LEVEL) {
        await escalateTask({ taskId: task.id, actorId: null, reason: "Automatically escalated: SLA breached (overdue).", auto: true });
        escalated++;
      }
    } else if (bucket === "DUE_SOON" && task.assignedToId) {
      await notifyTaskDueSoon(task.assignedToId, task.taskCode ?? task.id, task.title ?? task.taskType);
      dueSoonNotified++;
    }
  }

  const failedEvents = await prisma.workflowEvent.findMany({
    where: { status: "FAILED", attempts: { lt: RETRY_ATTEMPT_CAP } },
    select: { id: true },
    take: 100,
  });

  let retried = 0;
  let stillFailed = 0;
  for (const event of failedEvents) {
    const result = await retryWorkflowEvent(event.id, null);
    if (result.ok) retried++;
    else stillFailed++;
  }

  return { escalated, dueSoonNotified, overdueNotified, retried, stillFailed };
}
