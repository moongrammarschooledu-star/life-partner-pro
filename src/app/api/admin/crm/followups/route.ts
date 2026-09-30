import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { hasBroadRecordAccess } from "@/lib/permissions";
import { assertCanSeeCrmRecord } from "@/lib/crm/access";
import { createFollowup } from "@/lib/crm/followup-service";
import type { CrmFollowUpType, NotificationChannel, FollowUpPriority, FollowUpStatus } from "@prisma/client";

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("crm:followups:view");
    const q = new URL(req.url).searchParams;
    const crmRecordId = q.get("crmRecordId");

    if (crmRecordId) {
      const record = await prisma.crmRecord.findUnique({ where: { id: crmRecordId } });
      if (!record) throw new ApiError(404, "CRM record not found.");
      assertCanSeeCrmRecord(admin, record);
    }

    const items = await prisma.followUp.findMany({
      where: {
        crmRecordId: crmRecordId ?? { not: null },
        ...(q.get("status") ? { status: q.get("status") as FollowUpStatus } : {}),
        ...(!crmRecordId && !hasBroadRecordAccess(admin.role) ? { adminId: admin.id } : {}),
      },
      orderBy: { dueDate: "asc" },
      take: 200,
    });
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("crm:followups:create");
    const body = (await req.json()) as {
      crmRecordId?: string; type?: CrmFollowUpType; purpose?: string; channel?: NotificationChannel;
      dueDate?: string; priority?: FollowUpPriority; nextAction?: string;
    };
    if (!body.crmRecordId) throw new ApiError(400, "crmRecordId is required.");
    if (!body.type) throw new ApiError(400, "type is required.");
    if (!body.dueDate) throw new ApiError(400, "dueDate is required.");

    const record = await prisma.crmRecord.findUnique({ where: { id: body.crmRecordId } });
    if (!record) throw new ApiError(404, "CRM record not found.");
    assertCanSeeCrmRecord(admin, record);

    const followUp = await createFollowup({
      crmRecordId: body.crmRecordId,
      profileId: record.profileId,
      type: body.type,
      purpose: body.purpose,
      channel: body.channel,
      dueDate: new Date(body.dueDate),
      priority: body.priority,
      nextAction: body.nextAction,
      createdById: admin.id,
    });
    return NextResponse.json(followUp, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
