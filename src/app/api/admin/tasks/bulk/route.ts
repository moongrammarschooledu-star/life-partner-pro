import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { requireReason } from "@/lib/ops/admin-route";
import { assertTaskAccess } from "@/lib/workflow/access";
import { assignTask, reassignTask, transitionTask, WorkflowError } from "@/lib/workflow/engine";
import { writeAudit } from "@/lib/audit";
import type { AssignmentPriority } from "@prisma/client";

type BulkAction = "assign" | "priority" | "due_date" | "reassign" | "archive";

// STEP 18 §37/§62/§74 — bulk actions validate EVERY record independently:
// one unauthorized/invalid task in a batch is skipped, never silently
// applied and never allowed to abort or bypass checks for the rest of the
// batch. Each successful change gets its own audit entry (via the same
// engine functions single-task routes use), so a bulk action leaves an
// identical audit trail to doing it one at a time.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("tasks:bulk-actions");
    const body = (await req.json()) as {
      action?: BulkAction;
      taskIds?: string[];
      adminId?: string;
      priority?: AssignmentPriority;
      dueAt?: string | null;
      reason?: unknown;
    };

    const action = body.action;
    const taskIds = Array.isArray(body.taskIds) ? body.taskIds.filter((id) => typeof id === "string") : [];
    if (!action) throw new ApiError(400, "action is required.");
    if (taskIds.length === 0) throw new ApiError(400, "taskIds must be a non-empty array.");
    if (taskIds.length > 200) throw new ApiError(400, "Cannot bulk-act on more than 200 tasks at once.");

    const reasonText = action === "reassign" || action === "archive" ? requireReason(body.reason) : undefined;

    const succeeded: string[] = [];
    const failed: Array<{ taskId: string; reason: string }> = [];

    for (const taskId of taskIds) {
      try {
        const task = await prisma.adminTask.findUnique({ where: { id: taskId } });
        if (!task) throw new ApiError(404, "Task not found.");
        // The exact same per-record access chain every single-task route
        // uses — a task the caller cannot access is rejected here too,
        // regardless of how many other tasks in the batch they can access.
        await assertTaskAccess(admin, task, "MANAGE");

        switch (action) {
          case "assign": {
            if (!body.adminId) throw new ApiError(400, "adminId is required for a bulk assign.");
            await assignTask({ taskId, adminId: body.adminId, actorId: admin.id });
            break;
          }
          case "reassign": {
            if (!body.adminId) throw new ApiError(400, "adminId is required for a bulk reassign.");
            await reassignTask({ taskId, newAdminId: body.adminId, reason: reasonText!, actorId: admin.id });
            break;
          }
          case "priority": {
            if (!body.priority) throw new ApiError(400, "priority is required for a bulk priority change.");
            const updateResult = await prisma.adminTask.updateMany({ where: { id: taskId, version: task.version }, data: { priority: body.priority, version: { increment: 1 }, updatedAt: new Date() } });
            if (updateResult.count === 0) throw new WorkflowError(409, "This task was modified by someone else.");
            await writeAudit({ action: "TASK_PRIORITY_CHANGED", adminId: admin.id, meta: { taskId, previousPriority: task.priority, newPriority: body.priority, bulk: true } });
            break;
          }
          case "due_date": {
            const updateResult = await prisma.adminTask.updateMany({ where: { id: taskId, version: task.version }, data: { dueAt: body.dueAt ? new Date(body.dueAt) : null, version: { increment: 1 }, updatedAt: new Date() } });
            if (updateResult.count === 0) throw new WorkflowError(409, "This task was modified by someone else.");
            await writeAudit({ action: "TASK_DUE_DATE_CHANGED", adminId: admin.id, meta: { taskId, previousDueAt: task.dueAt, newDueAt: body.dueAt ?? null, bulk: true } });
            break;
          }
          case "archive": {
            await transitionTask({ taskId, newStatus: "ARCHIVED", actorId: admin.id, reason: reasonText });
            await writeAudit({ action: "TASK_ARCHIVED", adminId: admin.id, meta: { taskId, bulk: true } });
            break;
          }
          default:
            throw new ApiError(400, `Unknown bulk action: ${action}`);
        }

        succeeded.push(taskId);
      } catch (error) {
        failed.push({ taskId, reason: error instanceof Error ? error.message : "Unknown error" });
      }
    }

    return NextResponse.json({ succeeded, failed });
  } catch (error) {
    return handleApiError(error);
  }
}
