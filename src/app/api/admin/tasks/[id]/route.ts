import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { assertTaskAccess } from "@/lib/workflow/access";
import { writeAudit } from "@/lib/audit";
import type { AssignmentPriority } from "@prisma/client";

// STEP 18 §13/§14 — Task Detail. GET requires only VIEW; the source-record
// portion of the nine-step chain is enforced inside assertTaskAccess, so a
// task whose underlying record the caller cannot see returns 403 here
// (never partially — this route does not attempt to return a redacted task).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("tasks:view");
    const { id } = await params;
    const task = await prisma.adminTask.findUnique({
      where: { id },
      include: {
        assignedTo: { select: { id: true, name: true } },
        assignedDepartment: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        checklistItems: { orderBy: { order: "asc" } },
        statusHistory: { orderBy: { createdAt: "desc" } },
        escalations: { orderBy: { createdAt: "desc" } },
        dependsOn: { include: { dependsOnTask: { select: { id: true, taskCode: true, title: true, status: true } } } },
        dependedOnBy: { include: { task: { select: { id: true, taskCode: true, title: true, status: true } } } },
      },
    });
    if (!task) throw new ApiError(404, "Task not found.");

    const level = await assertTaskAccess(admin, task, "VIEW");
    const comments = await prisma.taskComment.findMany({
      where: { taskId: id, deletedAt: null, ...(admin.permissions.includes("tasks:comment:internal") ? {} : { visibility: { not: "MANAGER_ONLY" } }) },
      orderBy: { createdAt: "asc" },
      include: { author: { select: { id: true, name: true } } },
    });

    return NextResponse.json({ ...task, comments, accessLevel: level });
  } catch (error) {
    return handleApiError(error);
  }
}

// Optimistic concurrency (spec §47) — the caller must supply the version it
// last read; a mismatch means someone else changed the task in between and
// the client must reload rather than silently clobber that change.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("tasks:view");
    const { id } = await params;
    const body = (await req.json()) as {
      version: number;
      title?: string;
      description?: string;
      priority?: AssignmentPriority;
      dueAt?: string | null;
      notes?: string;
    };
    if (typeof body.version !== "number") throw new ApiError(400, "version is required.");

    const task = await prisma.adminTask.findUnique({ where: { id } });
    if (!task) throw new ApiError(404, "Task not found.");
    await assertTaskAccess(admin, task, "EDIT");

    const before = { title: task.title, priority: task.priority, dueAt: task.dueAt };
    const result = await prisma.adminTask.updateMany({
      where: { id, version: body.version },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.priority !== undefined ? { priority: body.priority } : {}),
        ...(body.dueAt !== undefined ? { dueAt: body.dueAt ? new Date(body.dueAt) : null } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        version: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    if (result.count === 0) {
      throw new ApiError(409, "This task was modified by someone else — reload and try again.");
    }

    if (body.priority !== undefined && body.priority !== before.priority) {
      await writeAudit({ action: "TASK_PRIORITY_CHANGED", adminId: admin.id, meta: { taskId: id, previousPriority: before.priority, newPriority: body.priority } });
    }
    if (body.dueAt !== undefined) {
      await writeAudit({ action: "TASK_DUE_DATE_CHANGED", adminId: admin.id, meta: { taskId: id, previousDueAt: before.dueAt, newDueAt: body.dueAt } });
    }

    const updated = await prisma.adminTask.findUnique({ where: { id } });
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
