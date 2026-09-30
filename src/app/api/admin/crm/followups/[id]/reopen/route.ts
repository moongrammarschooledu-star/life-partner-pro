import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { assertCanSeeCrmRecord } from "@/lib/crm/access";
import { reopenFollowup } from "@/lib/crm/followup-service";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("crm:followups:edit");
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { newDueDate?: string };

    const followUp = await prisma.followUp.findUnique({ where: { id } });
    if (!followUp) throw new ApiError(404, "Follow-up not found.");
    if (followUp.crmRecordId) {
      const record = await prisma.crmRecord.findUnique({ where: { id: followUp.crmRecordId } });
      if (record) assertCanSeeCrmRecord(admin, record);
    }

    const updated = await reopenFollowup(id, admin.id, body.newDueDate ? new Date(body.newDueDate) : undefined);
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
