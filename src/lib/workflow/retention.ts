import { prisma } from "@/lib/prisma";
import { getRetentionPolicy } from "@/lib/privacy/retention-policy";
import { hasActiveHold } from "@/lib/privacy/data-hold";
import { transitionTask } from "@/lib/workflow/engine";
import { TERMINAL_TASK_STATUSES } from "@/lib/workflow/status";

// STEP 18 §60 — reuses the existing RetentionPolicy/DataHold mechanism
// (WORKFLOW_TASK_DATA category) rather than a new archival subsystem, and
// the existing "retention" cron sub-task rather than a second trigger.
// "Archive" here means transitioning to AdminTaskStatus.ARCHIVED — the task
// row and its full audit/comment/attachment history are never deleted, only
// hidden from active work queues, matching the same soft-delete convention
// used everywhere else retention runs in this codebase.
export async function runTaskRetentionActions(): Promise<{ archived: number; skippedHold: number }> {
  const policy = await getRetentionPolicy("WORKFLOW_TASK_DATA");
  if (!policy || !policy.isActive || policy.action !== "ARCHIVE") {
    return { archived: 0, skippedHold: 0 };
  }

  const cutoff = new Date(Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000);
  const eligible = await prisma.adminTask.findMany({
    where: {
      status: { in: TERMINAL_TASK_STATUSES.filter((s) => s !== "ARCHIVED") },
      updatedAt: { lt: cutoff },
    },
    select: { id: true, resourceType: true, resourceId: true },
    take: 500,
  });

  let archived = 0;
  let skippedHold = 0;
  for (const task of eligible) {
    if (await hasActiveHold({ recordType: "AdminTask", recordId: task.id })) {
      skippedHold++;
      continue;
    }
    try {
      await transitionTask({ taskId: task.id, newStatus: "ARCHIVED", actorId: null, reason: "Automatic retention archive." });
      archived++;
    } catch {
      // A task that can't validly transition to ARCHIVED (e.g. concurrently
      // reopened) is simply skipped this run — it will be re-evaluated next
      // time, never forced.
    }
  }

  return { archived, skippedHold };
}
