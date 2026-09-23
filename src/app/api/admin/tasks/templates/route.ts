import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import type { AdminTaskType, AssignmentPriority } from "@prisma/client";

export async function GET() {
  try {
    await requireAdmin("tasks:templates:manage");
    const items = await prisma.taskTemplate.findMany({ orderBy: { name: "asc" } });
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("tasks:templates:manage");
    const body = (await req.json()) as {
      name?: string;
      taskType?: AdminTaskType;
      titleTemplate?: string;
      descriptionTemplate?: string;
      defaultPriority?: AssignmentPriority;
      defaultChecklist?: { label: string; required: boolean }[];
    };
    if (!body.name?.trim()) throw new ApiError(400, "name is required.");
    if (!body.taskType) throw new ApiError(400, "taskType is required.");
    if (!body.titleTemplate?.trim()) throw new ApiError(400, "titleTemplate is required.");

    const template = await prisma.taskTemplate.create({
      data: {
        name: body.name.trim(),
        taskType: body.taskType,
        titleTemplate: body.titleTemplate.trim(),
        descriptionTemplate: body.descriptionTemplate ?? null,
        defaultPriority: body.defaultPriority ?? "NORMAL",
        defaultChecklist: body.defaultChecklist ? JSON.parse(JSON.stringify(body.defaultChecklist)) : undefined,
        createdById: admin.id,
      },
    });

    await writeAudit({ action: "TASK_TEMPLATE_CREATED", adminId: admin.id, meta: { templateId: template.id, name: template.name } });
    return NextResponse.json(template);
  } catch (error) {
    return handleApiError(error);
  }
}
