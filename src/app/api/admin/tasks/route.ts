import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { hasBroadRecordAccess } from "@/lib/permissions";
import { createTask } from "@/lib/workflow/engine";
import { applyTemplate } from "@/lib/workflow/templates";
import type { AdminTaskType, AdminTaskStatus, AssignmentPriority, AssignmentResourceType, Prisma } from "@prisma/client";

// STEP 18 §10/§11/§12 — My Work Queue / Team Work Queue / Global Work. Scope
// is resolved server-side from the caller's own permissions, never trusted
// from the request. Row-level access.ts's nine-step chain is for opening a
// SPECIFIC task; a list is scoped by WHERE clause instead (same convention
// Case Management's dashboard already uses) — an unauthorized task simply
// never appears in the list rather than being filtered out one-by-one.
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("tasks:view");
    const { searchParams } = new URL(req.url);
    const scope = searchParams.get("scope") ?? "own";

    const where: Prisma.AdminTaskWhereInput = {};

    if (scope === "all") {
      if (!hasBroadRecordAccess(admin.role) && !admin.permissions.includes("tasks:view:all")) {
        throw new ApiError(403, "You do not have permission to view all tasks.");
      }
    } else if (scope === "team") {
      if (!admin.permissions.includes("tasks:view:team")) {
        throw new ApiError(403, "You do not have permission to view your team's tasks.");
      }
      const self = await prisma.adminUser.findUnique({ where: { id: admin.id }, select: { departmentId: true } });
      where.OR = self?.departmentId
        ? [{ assignedToId: admin.id }, { assignedTo: { departmentId: self.departmentId } }]
        : [{ assignedToId: admin.id }];
    } else {
      // "own" — always available to anyone holding the base tasks:view permission.
      where.assignedToId = admin.id;
    }

    const status = searchParams.get("status");
    if (status) where.status = status as AdminTaskStatus;
    const priority = searchParams.get("priority");
    if (priority) where.priority = priority as AssignmentPriority;
    const taskType = searchParams.get("taskType");
    if (taskType) where.taskType = taskType as AdminTaskType;
    const resourceType = searchParams.get("resourceType");
    if (resourceType) where.resourceType = resourceType as AssignmentResourceType;
    const search = searchParams.get("search");
    if (search?.trim()) where.taskCode = { contains: search.trim(), mode: "insensitive" };
    const overdue = searchParams.get("overdue");
    if (overdue === "true") where.dueAt = { lt: new Date() };

    const [items, total] = await Promise.all([
      prisma.adminTask.findMany({
        where,
        orderBy: [{ priority: "desc" }, { dueAt: "asc" }],
        take: 200,
        include: { assignedTo: { select: { id: true, name: true } }, assignedDepartment: { select: { id: true, name: true } } },
      }),
      prisma.adminTask.count({ where }),
    ]);

    return NextResponse.json({ items, total });
  } catch (error) {
    return handleApiError(error);
  }
}

// Spec §6/§58 — manual "Create Task". Every field the admin controls is
// validated server-side; the created task's own detail/action routes (via
// assertTaskAccess) independently gate who can ever open or act on it
// afterward, regardless of who created it.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("tasks:create:manual");
    const body = (await req.json()) as {
      taskType?: AdminTaskType;
      resourceType?: AssignmentResourceType;
      resourceId?: string;
      title?: string;
      description?: string;
      priority?: AssignmentPriority;
      dueAt?: string;
      notes?: string;
      assignedToId?: string;
      assignedDepartmentId?: string;
      templateId?: string;
    };

    if (!body.resourceType || !body.resourceId) throw new ApiError(400, "resourceType and resourceId are required.");

    let draft: Partial<Parameters<typeof createTask>[0]> & { checklist?: { label: string; required: boolean }[] } = {
      taskType: body.taskType,
      title: body.title,
      description: body.description,
      priority: body.priority,
    };
    if (body.templateId) {
      draft = await applyTemplate(body.templateId, draft);
    }
    if (!draft.taskType) throw new ApiError(400, "taskType is required (directly, or via a templateId).");

    const task = await createTask({
      taskType: draft.taskType,
      resourceType: body.resourceType,
      resourceId: body.resourceId,
      title: draft.title,
      description: draft.description,
      priority: draft.priority,
      dueAt: body.dueAt ? new Date(body.dueAt) : undefined,
      notes: body.notes,
      assignedToId: body.assignedToId,
      assignedDepartmentId: body.assignedDepartmentId,
      createdById: admin.id,
      dedupe: false, // a manual creation is deliberate — never silently returns someone else's task instead
    });

    if (draft.checklist?.length) {
      await prisma.taskChecklistItem.createMany({
        data: draft.checklist.map((item, index) => ({ taskId: task.id, label: item.label, required: item.required, order: index })),
      });
    }

    return NextResponse.json(task);
  } catch (error) {
    return handleApiError(error);
  }
}
