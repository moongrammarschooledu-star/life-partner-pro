import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { AdminTaskType } from "@prisma/client";

// STEP 18 §20 — per-task-type SLA targets are genuinely admin-configurable,
// not hardcoded. A task type with no row yet is returned with nulls (no
// SLA) rather than a silently invented default.
export async function GET() {
  try {
    await requireAdmin("tasks:sla:manage");
    const configs = await prisma.taskSlaConfig.findMany();
    const byType = new Map(configs.map((c) => [c.taskType, c]));
    const items = Object.values(AdminTaskType).map((taskType) => byType.get(taskType) ?? { id: null, taskType, targetResponseHours: null, targetResolutionHours: null, warningThresholdHours: null, active: false });
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(req: Request) {
  try {
    const admin = await requireAdmin("tasks:sla:manage");
    const body = (await req.json()) as { taskType?: AdminTaskType; targetResponseHours?: number | null; targetResolutionHours?: number | null; warningThresholdHours?: number | null; active?: boolean };
    if (!body.taskType || !Object.values(AdminTaskType).includes(body.taskType)) throw new ApiError(400, "A valid taskType is required.");

    const config = await prisma.taskSlaConfig.upsert({
      where: { taskType: body.taskType },
      update: {
        targetResponseHours: body.targetResponseHours ?? null,
        targetResolutionHours: body.targetResolutionHours ?? null,
        warningThresholdHours: body.warningThresholdHours ?? null,
        active: body.active ?? true,
      },
      create: {
        taskType: body.taskType,
        targetResponseHours: body.targetResponseHours ?? null,
        targetResolutionHours: body.targetResolutionHours ?? null,
        warningThresholdHours: body.warningThresholdHours ?? null,
        active: body.active ?? true,
      },
    });

    await writeAudit({ action: "TASK_SLA_CONFIG_UPDATED", adminId: admin.id, meta: { slaConfigTaskType: body.taskType } });
    return NextResponse.json(config);
  } catch (error) {
    return handleApiError(error);
  }
}
