import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";

// Spec §28 — SUPER_ADMIN only (cases:merge). The source case is closed with
// mergedIntoCaseId set; its full history (comments/notes/evidence/status
// history) is left completely intact, never deleted.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("cases:merge");
    const { sourceCaseId, targetCaseId, reason } = (await req.json()) as { sourceCaseId?: string; targetCaseId?: string; reason?: string };
    if (!sourceCaseId || !targetCaseId) throw new ApiError(400, "sourceCaseId and targetCaseId are required.");
    if (sourceCaseId === targetCaseId) throw new ApiError(400, "A case cannot be merged into itself.");
    if (!reason?.trim()) throw new ApiError(400, "A merge reason is required.");

    const [source, target] = await Promise.all([
      prisma.case.findUnique({ where: { id: sourceCaseId } }),
      prisma.case.findUnique({ where: { id: targetCaseId } }),
    ]);
    if (!source || !target) throw new ApiError(404, "Case not found");
    if (source.mergedIntoCaseId) throw new ApiError(400, "This case has already been merged.");

    await prisma.$transaction([
      prisma.case.update({ where: { id: sourceCaseId }, data: { mergedIntoCaseId: targetCaseId, status: "CLOSED", closedAt: new Date() } }),
      prisma.caseStatusHistory.create({ data: { caseId: sourceCaseId, fromStatus: source.status, toStatus: "CLOSED", changedById: admin.id, reason: `Merged into ${target.caseNumber}: ${reason.trim()}` } }),
      prisma.caseMerge.create({ data: { sourceCaseId, targetCaseId, reason: reason.trim(), mergedById: admin.id } }),
      prisma.caseLink.create({ data: { caseId: targetCaseId, linkedCaseId: sourceCaseId, linkType: "DUPLICATE_OF", createdById: admin.id } }),
    ]);

    await writeAudit({ action: "CASE_MERGED", adminId: admin.id, meta: { sourceCaseId, targetCaseId, reason: reason.trim() } });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
