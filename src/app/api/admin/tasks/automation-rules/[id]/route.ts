import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import type { AssignmentPriority, AdminRole } from "@prisma/client";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("tasks:automation:manage");
    const { id } = await params;
    const body = (await req.json()) as { defaultPriority?: AssignmentPriority; defaultAssignedRole?: AdminRole | null; defaultAssignedDepartmentId?: string | null; active?: boolean };

    const existing = await prisma.workflowRule.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "Automation rule not found.");

    const updated = await prisma.workflowRule.update({
      where: { id },
      data: {
        ...(body.defaultPriority !== undefined ? { defaultPriority: body.defaultPriority } : {}),
        ...(body.defaultAssignedRole !== undefined ? { defaultAssignedRole: body.defaultAssignedRole } : {}),
        ...(body.defaultAssignedDepartmentId !== undefined ? { defaultAssignedDepartmentId: body.defaultAssignedDepartmentId } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
      },
    });

    await writeAudit({ action: "WORKFLOW_RULE_UPDATED", adminId: admin.id, meta: { ruleId: id, eventName: existing.eventName } });
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
