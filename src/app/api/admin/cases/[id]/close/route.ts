import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { assertCaseAccess } from "@/lib/case-access";
import { changeCaseStatus } from "@/lib/case-status";
import { notifyCaseClosed } from "@/lib/notifications/events";
import { writeAudit } from "@/lib/audit";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("cases:close");
    const { id } = await params;

    const caseRecord = await prisma.case.findUnique({ where: { id } });
    if (!caseRecord) throw new ApiError(404, "Case not found");
    await assertCaseAccess(admin, caseRecord, "EDIT");

    await changeCaseStatus({ caseId: id, toStatus: "CLOSED", adminId: admin.id, notifyUser: false });
    await prisma.case.update({ where: { id }, data: { closedAt: new Date() } });
    await writeAudit({ action: "CASE_CLOSED", adminId: admin.id, meta: { caseId: id } });
    await notifyCaseClosed(caseRecord.reporterProfileId);

    return NextResponse.json({ ok: true, status: "CLOSED" });
  } catch (error) {
    return handleApiError(error);
  }
}
