import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import type { AssignmentPriority } from "@prisma/client";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("tasks:templates:manage");
    const { id } = await params;
    const body = (await req.json()) as {
      name?: string;
      titleTemplate?: string;
      descriptionTemplate?: string;
      defaultPriority?: AssignmentPriority;
      defaultChecklist?: { label: string; required: boolean }[];
      active?: boolean;
    };

    const existing = await prisma.taskTemplate.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "Template not found.");

    const updated = await prisma.taskTemplate.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.titleTemplate !== undefined ? { titleTemplate: body.titleTemplate.trim() } : {}),
        ...(body.descriptionTemplate !== undefined ? { descriptionTemplate: body.descriptionTemplate } : {}),
        ...(body.defaultPriority !== undefined ? { defaultPriority: body.defaultPriority } : {}),
        ...(body.defaultChecklist !== undefined ? { defaultChecklist: JSON.parse(JSON.stringify(body.defaultChecklist)) } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
      },
    });

    await writeAudit({ action: "TASK_TEMPLATE_UPDATED", adminId: admin.id, meta: { templateId: id } });
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
