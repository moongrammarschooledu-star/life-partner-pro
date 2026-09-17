import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { assertCaseAccess } from "@/lib/case-access";
import { changeCaseStatus } from "@/lib/case-status";
import { notifyInformationRequested } from "@/lib/notifications/events";
import { writeAudit } from "@/lib/audit";

// Spec §14 — "Request More Information" flips the case to Waiting for User;
// the request itself is a user-visible CaseComment, never an internal note.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("cases:edit");
    const { id } = await params;
    const { message } = (await req.json()) as { message?: string };
    if (!message?.trim()) throw new ApiError(400, "A message describing what's needed is required.");

    const caseRecord = await prisma.case.findUnique({ where: { id } });
    if (!caseRecord) throw new ApiError(404, "Case not found");
    await assertCaseAccess(admin, caseRecord, "COMMENT");

    await prisma.caseComment.create({ data: { caseId: id, authorAdminId: admin.id, body: message.trim(), visibleToUser: true } });
    await changeCaseStatus({ caseId: id, toStatus: "WAITING_FOR_USER", adminId: admin.id, notifyUser: false });
    await notifyInformationRequested(caseRecord.reporterProfileId);
    await writeAudit({ action: "INFORMATION_REQUESTED", adminId: admin.id, meta: { caseId: id } });

    return NextResponse.json({ ok: true, status: "WAITING_FOR_USER" });
  } catch (error) {
    return handleApiError(error);
  }
}
