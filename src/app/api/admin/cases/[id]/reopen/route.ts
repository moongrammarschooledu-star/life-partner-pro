import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { assertCaseAccess } from "@/lib/case-access";
import { changeCaseStatus } from "@/lib/case-status";
import { notifyCaseReopened } from "@/lib/notifications/events";
import { writeAudit } from "@/lib/audit";
import { getCurrentAssigneeId } from "@/lib/admin-assignment";

// Spec §23 — reopening a resolved/closed case requires a reason.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("cases:reopen");
    const { id } = await params;
    const { reason } = (await req.json()) as { reason?: string };
    if (!reason?.trim()) throw new ApiError(400, "A reason is required to reopen a case.");

    const caseRecord = await prisma.case.findUnique({ where: { id } });
    if (!caseRecord) throw new ApiError(404, "Case not found");
    if (caseRecord.status !== "RESOLVED" && caseRecord.status !== "CLOSED") {
      throw new ApiError(400, "Only a resolved or closed case can be reopened.");
    }
    await assertCaseAccess(admin, caseRecord, "EDIT");

    await changeCaseStatus({ caseId: id, toStatus: "REOPENED", adminId: admin.id, reason: reason.trim(), notifyUser: false });
    await prisma.case.update({ where: { id }, data: { closedAt: null } });
    await writeAudit({ action: "CASE_REOPENED", adminId: admin.id, meta: { caseId: id, reason: reason.trim() } });

    const assignedToId = await getCurrentAssigneeId("CASE", id);
    await notifyCaseReopened(caseRecord.reporterProfileId, assignedToId);

    return NextResponse.json({ ok: true, status: "REOPENED" });
  } catch (error) {
    return handleApiError(error);
  }
}
