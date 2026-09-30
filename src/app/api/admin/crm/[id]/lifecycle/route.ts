import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { assertCanSeeCrmRecord } from "@/lib/crm/access";
import { transitionStage, InvalidLifecycleTransitionError } from "@/lib/crm/lifecycle-service";
import type { CrmLifecycleStage } from "@prisma/client";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("crm:lifecycle:manage");
    const { id } = await params;
    const body = (await req.json()) as { toStage?: CrmLifecycleStage; reason?: string };
    if (!body.toStage) throw new ApiError(400, "toStage is required.");

    const record = await prisma.crmRecord.findUnique({ where: { id } });
    if (!record) throw new ApiError(404, "CRM record not found.");
    assertCanSeeCrmRecord(admin, record);

    try {
      const updated = await transitionStage({ crmRecordId: id, toStage: body.toStage, reason: body.reason, actorId: admin.id, triggeredBy: "MANUAL" });
      return NextResponse.json(updated);
    } catch (error) {
      if (error instanceof InvalidLifecycleTransitionError) throw new ApiError(409, error.message);
      throw error;
    }
  } catch (error) {
    return handleApiError(error);
  }
}
