import { prisma } from "@/lib/prisma";
import type { AdminTaskType, AssignmentResourceType, AdminTask } from "@prisma/client";
import { ACTIVE_TASK_STATUSES } from "@/lib/workflow/status";

// STEP 18 §54 — before auto-creating a task, check whether an equivalent
// open one already exists for the same source record + task type. This is
// the fix for the pre-existing sendOverdueFollowUpAlerts() bug (STEP 9),
// which had no such guard and created a fresh duplicate AdminTask every
// single daily cron tick for as long as a follow-up stayed overdue.
export async function findExistingOpenTask(resourceType: AssignmentResourceType, resourceId: string, taskType: AdminTaskType): Promise<AdminTask | null> {
  return prisma.adminTask.findFirst({
    where: { resourceType, resourceId, taskType, status: { in: ACTIVE_TASK_STATUSES } },
    orderBy: { createdAt: "desc" },
  });
}
