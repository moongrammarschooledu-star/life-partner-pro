import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { hasBroadRecordAccess, type AdminRole } from "@/lib/permissions";
import { assertVerificationAccess } from "@/lib/verification-access";
import { setVerificationStatus, suspendProfile } from "@/lib/verification/status";
import { writeAudit } from "@/lib/audit";
import { createAssignment } from "@/lib/admin-assignment";
import { notifyVerificationAssigned } from "@/lib/notifications/events";
import { enforceApprovalGate, markApprovalExecuted } from "@/lib/approvals/gate";

// STEP 17 §25 — a narrow-role admin (VERIFICATION_STAFF etc.) who has been
// separately granted an approve/reject/reverify permission still cannot
// rubber-stamp a case they personally reviewed; a broad-access manager role
// (VERIFICATION_MANAGER/SUPER_ADMIN/OPERATIONS_ADMIN) is expected to be able
// to review and decide solo, so this only guards the narrower roles.
function assertNotSelfReviewed(admin: { id: string; role: string }, verification: { lastReviewedById: string | null }) {
  if (!hasBroadRecordAccess(admin.role as AdminRole) && verification.lastReviewedById && verification.lastReviewedById === admin.id) {
    throw new ApiError(403, "You cannot approve, reject, or require re-verification for a case you already reviewed — assign it to another reviewer.");
  }
}

const REJECTION_CATEGORIES = ["INFORMATION_INCOMPLETE", "INFORMATION_INCONSISTENT", "VERIFICATION_FAILED", "DUPLICATE_ACCOUNT_SUSPECTED", "POLICY_VIOLATION", "OTHER"];

// Single dispatch endpoint for the 5 admin actions from spec §14: Approve,
// Request More Information, Reject, Suspend, Require Re-Verification — all
// but Suspend route through the central setVerificationStatus() transition
// helper (src/lib/verification/status.ts); Suspend is a Profile-level
// lifecycle action instead (spec §17 treats SUSPENDED as excluded from
// matching alongside archived/rejected, not as one of the 8 verification
// statuses).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("verification:review");
    const { id } = await params;
    const body = await req.json();
    const { action } = body;

    const verification = await prisma.profileVerification.findUnique({ where: { profileId: id } });
    if (!verification) throw new ApiError(404, "Verification record not found");
    assertVerificationAccess(admin, verification);

    switch (action) {
      case "approve": {
        if (!admin.permissions.includes("verification:approve")) throw new ApiError(403, "You do not have permission to approve verifications.");
        assertNotSelfReviewed(admin, verification);

        // STEP 19 §13 — maker-checker gate on the formal verification
        // decision. sourceId is the ProfileVerification row's own id (not
        // profileId) so src/lib/approvals/conflict.ts's
        // VERIFICATION_MAKER_CONFLICT check can look it back up directly.
        const gate = await enforceApprovalGate({
          actionType: "VERIFICATION_APPROVE",
          sourceType: "VERIFICATION",
          sourceId: verification.id,
          actor: admin,
          reason: body.note?.trim() || "Verification approved.",
        });
        if (gate.requiresApproval && gate.status !== "READY_TO_EXECUTE") {
          return NextResponse.json({ approvalRequired: true, approvalCode: gate.approvalCode, status: gate.status }, { status: 202 });
        }

        await setVerificationStatus(id, "VERIFIED", { adminId: admin.id, note: body.note });
        if (gate.requiresApproval) await markApprovalExecuted(gate.approvalRequestId, admin.id);
        break;
      }
      case "request_more_info": {
        if (!admin.permissions.includes("verification:request-info")) throw new ApiError(403, "You do not have permission to request more information.");
        const items: string[] = Array.isArray(body.items) ? body.items : [];
        if (items.length === 0) throw new ApiError(400, "Select at least one item to request.");
        await setVerificationStatus(id, "VERIFICATION_REQUIRED", { adminId: admin.id, note: body.note, requestedInfoItems: items });
        break;
      }
      case "reject": {
        if (!admin.permissions.includes("verification:reject")) throw new ApiError(403, "You do not have permission to reject verifications.");
        assertNotSelfReviewed(admin, verification);
        if (!body.rejectionReasonCategory || !REJECTION_CATEGORIES.includes(body.rejectionReasonCategory)) {
          throw new ApiError(400, "A rejection reason category is required.");
        }
        await setVerificationStatus(id, "VERIFICATION_REJECTED", {
          adminId: admin.id,
          rejectionReasonCategory: body.rejectionReasonCategory,
          rejectionNote: body.rejectionNote,
        });
        break;
      }
      case "suspend": {
        await suspendProfile(id, { adminId: admin.id, reason: body.reason });
        break;
      }
      case "require_reverification": {
        if (!admin.permissions.includes("verification:reverify")) throw new ApiError(403, "You do not have permission to require re-verification.");
        assertNotSelfReviewed(admin, verification);
        await setVerificationStatus(id, "RE_VERIFICATION_REQUIRED", { adminId: admin.id, reVerificationReason: body.reason, note: body.note });
        break;
      }
      case "assign": {
        if (!admin.permissions.includes("verification:assign")) throw new ApiError(403, "You do not have permission to assign verifications.");
        const assignedToId: string | null = body.assignedToId || null;
        await prisma.profileVerification.update({ where: { profileId: id }, data: { assignedToId } });
        await writeAudit({ action: "VERIFICATION_ASSIGNED", adminId: admin.id, targetProfileId: id, meta: { assignedToId } });
        await notifyVerificationAssigned(id, assignedToId);
        if (assignedToId) {
          await createAssignment({ adminId: assignedToId, resourceType: "VERIFICATION", resourceId: id, createdById: admin.id });
        }
        break;
      }
      default:
        throw new ApiError(400, "Unknown action");
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
