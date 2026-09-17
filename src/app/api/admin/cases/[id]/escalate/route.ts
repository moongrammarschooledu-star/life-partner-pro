import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { assertCaseAccess } from "@/lib/case-access";
import { writeAudit } from "@/lib/audit";
import { notifyCaseEscalated } from "@/lib/notifications/events";
import { getCurrentAssigneeId } from "@/lib/admin-assignment";

// Spec §15 — 4 escalation levels mapped onto the existing role model (no new
// "Senior Admin" role): Level 1->2 needs cases:escalate; Level 2->3 needs
// cases:escalate:senior (granted to ADMIN by default, revocable per-admin or
// via a custom role); Level 3->4 is SUPER_ADMIN only.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("cases:escalate");
    const { id } = await params;
    const { reason } = (await req.json()) as { reason?: string };
    if (!reason?.trim()) throw new ApiError(400, "An escalation reason is required.");

    const caseRecord = await prisma.case.findUnique({ where: { id } });
    if (!caseRecord) throw new ApiError(404, "Case not found");
    await assertCaseAccess(admin, caseRecord, "EDIT");

    const previousLevel = caseRecord.escalationLevel;
    const newLevel = Math.min(4, previousLevel + 1);
    if (newLevel === previousLevel) throw new ApiError(400, "This case is already at the highest escalation level.");

    if (newLevel >= 3 && !admin.permissions.includes("cases:escalate:senior")) {
      throw new ApiError(403, "Escalating to this level requires senior escalation permission.");
    }
    if (newLevel >= 4 && admin.role !== "SUPER_ADMIN") {
      throw new ApiError(403, "Only a Super Admin can escalate to the highest level.");
    }

    await prisma.$transaction([
      prisma.case.update({ where: { id }, data: { escalationLevel: newLevel, status: "ESCALATED" } }),
      prisma.caseEscalation.create({ data: { caseId: id, previousLevel, newLevel, reason: reason.trim(), escalatedById: admin.id } }),
      prisma.caseStatusHistory.create({ data: { caseId: id, fromStatus: caseRecord.status, toStatus: "ESCALATED", changedById: admin.id, reason: reason.trim() } }),
    ]);

    await writeAudit({ action: "CASE_ESCALATED", adminId: admin.id, meta: { caseId: id, previousLevel, newLevel, reason: reason.trim() } });

    const assignedToId = await getCurrentAssigneeId("CASE", id);
    await notifyCaseEscalated(assignedToId);

    return NextResponse.json({ ok: true, escalationLevel: newLevel });
  } catch (error) {
    return handleApiError(error);
  }
}
