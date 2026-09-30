import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { hasBroadRecordAccess } from "@/lib/permissions";
import { requireReason } from "@/lib/ops/admin-route";
import { reassignRecord } from "@/lib/crm/assignment-service";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("crm:reassign");
    const { id } = await params;
    const body = (await req.json()) as { adminId?: string; reason?: unknown };
    if (!body.adminId) throw new ApiError(400, "adminId is required.");
    const reason = requireReason(body.reason);

    const record = await prisma.crmRecord.findUnique({ where: { id } });
    if (!record) throw new ApiError(404, "CRM record not found.");
    if (!hasBroadRecordAccess(admin.role)) throw new ApiError(403, "You do not have permission to reassign CRM records.");

    await reassignRecord("CRM_RECORD", id, body.adminId, reason, admin.id);
    return NextResponse.json({ assignedTo: body.adminId });
  } catch (error) {
    return handleApiError(error);
  }
}
