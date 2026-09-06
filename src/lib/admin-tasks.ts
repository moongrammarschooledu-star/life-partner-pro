import { prisma } from "@/lib/prisma";
import type { AdminTaskType, AssignmentResourceType, AssignmentPriority } from "@prisma/client";

// New, real feature (spec §23/§24) auto-created at existing STEP 9
// notification trigger points (see src/lib/notifications/events.ts) — never
// a new parallel trigger system, so a task and its notification are always
// created together and can't drift apart. No audit entry is written on
// creation (would roughly double audit volume for routine events with no
// security value); only admin-initiated reassignment/completion is audited,
// via the callers of this module.
export async function createTask(params: {
  assignedToId?: string | null;
  taskType: AdminTaskType;
  resourceType: AssignmentResourceType;
  resourceId: string;
  priority?: AssignmentPriority;
  dueAt?: Date | null;
  notes?: string | null;
}) {
  return prisma.adminTask.create({
    data: {
      assignedToId: params.assignedToId ?? null,
      taskType: params.taskType,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      priority: params.priority ?? "NORMAL",
      dueAt: params.dueAt ?? null,
      notes: params.notes ?? null,
    },
  });
}
