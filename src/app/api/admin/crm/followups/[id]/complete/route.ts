import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { assertCanSeeCrmRecord } from "@/lib/crm/access";
import { completeFollowup } from "@/lib/crm/followup-service";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("crm:followups:complete");
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { outcome?: string };

    const followUp = await prisma.followUp.findUnique({ where: { id } });
    if (!followUp) throw new ApiError(404, "Follow-up not found.");
    if (followUp.crmRecordId) {
      const record = await prisma.crmRecord.findUnique({ where: { id: followUp.crmRecordId } });
      if (record) assertCanSeeCrmRecord(admin, record);
    }

    const updated = await completeFollowup(id, admin.id, body.outcome);
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
