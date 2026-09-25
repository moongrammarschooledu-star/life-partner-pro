import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { enforceApprovalGate, markApprovalExecuted } from "@/lib/approvals/gate";
import { writeAudit } from "@/lib/audit";
import { notifyFamilyAccessGranted, notifyFamilyAccessRevoked } from "@/lib/notifications/events";

// STEP 19 governance for FAMILY_ACCESS_GRANT — an admin approving a sensitive
// family permission still goes through the exact same quorum/policy check as
// any other high-risk action (Decision 10). "decision" here is the admin's
// own approve/reject of the underlying grant, gated by enforceApprovalGate.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("family:manage");
    const { id } = await params;
    const { decision, reason } = await req.json(); // decision: "approve" | "reject"
    if (decision !== "approve" && decision !== "reject") throw new ApiError(400, "Invalid decision.");
    if (!reason || typeof reason !== "string") throw new ApiError(400, "A reason is required.");

    const permission = await prisma.familyPermission.findUnique({
      where: { id },
      include: { familyMember: { select: { id: true, familyAccount: { select: { applicantId: true } } } } },
    });
    if (!permission || permission.status !== "PENDING_APPROVAL") throw new ApiError(404, "Pending permission not found.");

    const gate = await enforceApprovalGate({
      actionType: "FAMILY_ACCESS_GRANT",
      sourceType: "PROFILE",
      sourceId: permission.familyMember.familyAccount.applicantId,
      actor: admin,
      reason,
      requestedPayload: { familyMemberId: permission.familyMemberId, permission: permission.permission, decision },
    });
    if (gate.requiresApproval && gate.status !== "READY_TO_EXECUTE") {
      return NextResponse.json({ approvalRequired: true, approvalCode: gate.approvalCode, status: gate.status }, { status: 202 });
    }

    const applicantId = permission.familyMember.familyAccount.applicantId;

    if (decision === "approve") {
      await prisma.familyPermission.update({ where: { id }, data: { status: "ACTIVE", grantedByAdminId: admin.id } });
      await writeAudit({ action: "FAMILY_ACCESS_APPROVED", adminId: admin.id, targetProfileId: applicantId, meta: { permissionId: id, permission: permission.permission } });
      await notifyFamilyAccessGranted(permission.familyMemberId);
    } else {
      await prisma.familyPermission.update({ where: { id }, data: { status: "REJECTED" } });
      await writeAudit({ action: "FAMILY_ACCESS_REJECTED", adminId: admin.id, targetProfileId: applicantId, meta: { permissionId: id, permission: permission.permission } });
      await notifyFamilyAccessRevoked(permission.familyMemberId);
    }

    if (gate.requiresApproval) await markApprovalExecuted(gate.approvalRequestId, admin.id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
