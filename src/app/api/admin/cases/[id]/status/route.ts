import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { assertCaseAccess } from "@/lib/case-access";
import { changeCaseStatus } from "@/lib/case-status";
import type { CaseStatus } from "@prisma/client";

const VALID_STATUSES: CaseStatus[] = ["NEW", "ACKNOWLEDGED", "ASSIGNED", "IN_REVIEW", "WAITING_FOR_USER", "WAITING_FOR_STAFF", "ESCALATED", "ACTION_REQUIRED", "RESOLVED", "CLOSED", "REOPENED", "ARCHIVED"];

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("cases:edit");
    const { id } = await params;
    const { status, reason } = (await req.json()) as { status?: string; reason?: string };
    if (!status || !VALID_STATUSES.includes(status as CaseStatus)) throw new ApiError(400, "Invalid status.");

    const caseRecord = await prisma.case.findUnique({ where: { id } });
    if (!caseRecord) throw new ApiError(404, "Case not found");
    await assertCaseAccess(admin, caseRecord, "EDIT");

    const updated = await changeCaseStatus({ caseId: id, toStatus: status as CaseStatus, adminId: admin.id, reason });
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
