import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { assertCanSeeCrmRecord } from "@/lib/crm/access";
import { getLifecycleHistory } from "@/lib/crm/lifecycle-service";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("crm:lifecycle:view");
    const { id } = await params;
    const record = await prisma.crmRecord.findUnique({ where: { id } });
    if (!record) throw new ApiError(404, "CRM record not found.");
    assertCanSeeCrmRecord(admin, record);

    const history = await getLifecycleHistory(id);
    return NextResponse.json({ items: history });
  } catch (error) {
    return handleApiError(error);
  }
}
