import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { hasBroadRecordAccess } from "@/lib/permissions";
import { assignRecord, autoAssign } from "@/lib/crm/assignment-service";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("crm:assign");
    const { id } = await params;
    const body = (await req.json()) as { adminId?: string; auto?: boolean; departmentId?: string | null };

    const record = await prisma.crmRecord.findUnique({ where: { id } });
    if (!record) throw new ApiError(404, "CRM record not found.");
    // Assignment is itself a broad-access action — a scoped role assigning
    // records to others would bypass the "no assignment = no access" rule
    // this whole module is built on.
    if (!hasBroadRecordAccess(admin.role)) throw new ApiError(403, "You do not have permission to assign CRM records.");

    if (body.auto) {
      const chosen = await autoAssign("CRM_RECORD", id, body.departmentId ?? record.assignedTeamId ?? null, admin.id);
      if (!chosen) throw new ApiError(409, "No assignment rule is configured (or no eligible staff) for automatic assignment.");
      return NextResponse.json({ assignedTo: chosen });
    }

    if (!body.adminId) throw new ApiError(400, "adminId is required (or set auto: true).");
    await assignRecord("CRM_RECORD", id, body.adminId, admin.id);
    return NextResponse.json({ assignedTo: body.adminId });
  } catch (error) {
    return handleApiError(error);
  }
}
