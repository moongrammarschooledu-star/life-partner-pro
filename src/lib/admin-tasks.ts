import { createTask as createWorkflowTask } from "@/lib/workflow/engine";
import type { AdminTaskType, AssignmentResourceType, AssignmentPriority } from "@prisma/client";

// STEP 11's original task primitive (spec §23/§24), auto-created at existing
// STEP 9 notification trigger points (see src/lib/notifications/events.ts) —
// never a new parallel trigger system, so a task and its notification are
// always created together and can't drift apart.
//
// STEP 18 — this is now a thin backward-compatible shim over
// WorkflowEngine.createTask(): the 8 existing call sites below need zero
// code changes, but automatically gain real dedup-by-source-record+type
// (an equivalent open task is returned instead of duplicated). This fixes
// the pre-existing sendOverdueFollowUpAlerts() bug, which had no such guard
// and created a fresh duplicate task every single daily cron tick for as
// long as a follow-up stayed overdue.
export async function createTask(params: {
  assignedToId?: string | null;
  taskType: AdminTaskType;
  resourceType: AssignmentResourceType;
  resourceId: string;
  priority?: AssignmentPriority;
  dueAt?: Date | null;
  notes?: string | null;
}) {
  return createWorkflowTask({
    assignedToId: params.assignedToId,
    taskType: params.taskType,
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    priority: params.priority,
    dueAt: params.dueAt,
    notes: params.notes,
    createdById: null,
  });
}
