import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { assertCaseAccess } from "@/lib/case-access";
import { createAssignment, reassignAssignment, getCurrentAssigneeId } from "@/lib/admin-assignment";
import { detectCaseConflictOfInterest } from "@/lib/case-conflict";
import { notifyCaseAssigned, notifyCaseReassigned } from "@/lib/notifications/events";

// Spec §10/§20 — assignment is the access-granting mechanism itself, so no
// extra row-level gate beyond holding cases:assign is required to assign;
// conflict-of-interest is a soft warning the caller must explicitly
// override, never a hard block (spec §20).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("cases:assign");
    const { id } = await params;
    const { assignedToId, priority, dueAt, reason, confirmOverrideConflict } = (await req.json()) as {
      assignedToId?: string; priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT"; dueAt?: string; reason?: string; confirmOverrideConflict?: boolean;
    };
    if (!assignedToId) throw new ApiError(400, "assignedToId is required.");

    const caseRecord = await prisma.case.findUnique({ where: { id } });
    if (!caseRecord) throw new ApiError(404, "Case not found");
    await assertCaseAccess(admin, caseRecord, "EDIT");

    const staff = await prisma.adminUser.findUnique({ where: { id: assignedToId } });
    if (!staff || !staff.active) throw new ApiError(400, "Invalid staff member.");

    const warnings = await detectCaseConflictOfInterest(id, assignedToId);
    if (warnings.length > 0 && !confirmOverrideConflict) {
      return NextResponse.json({ conflictWarnings: warnings }, { status: 409 });
    }

    const currentAssigneeId = await getCurrentAssigneeId("CASE", id);
    if (currentAssigneeId) {
      await reassignAssignment({
        resourceType: "CASE",
        resourceId: id,
        newAdminId: assignedToId,
        reason: reason || "Reassigned",
        createdById: admin.id,
        priority,
        dueAt: dueAt ? new Date(dueAt) : undefined,
      });
      await notifyCaseReassigned(assignedToId);
    } else {
      await createAssignment({
        adminId: assignedToId,
        resourceType: "CASE",
        resourceId: id,
        priority,
        dueAt: dueAt ? new Date(dueAt) : null,
        createdById: admin.id,
      });
      if (caseRecord.status === "NEW") {
        await prisma.case.update({ where: { id }, data: { status: "ASSIGNED" } });
        await prisma.caseStatusHistory.create({ data: { caseId: id, fromStatus: "NEW", toStatus: "ASSIGNED", changedById: admin.id } });
      }
      await notifyCaseAssigned(id, assignedToId);
    }

    return NextResponse.json({ ok: true, assignedToId });
  } catch (error) {
    return handleApiError(error);
  }
}
