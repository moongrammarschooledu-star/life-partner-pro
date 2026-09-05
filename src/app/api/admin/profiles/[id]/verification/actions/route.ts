import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { assertVerificationAccess } from "@/lib/verification-access";
import { setVerificationStatus, suspendProfile } from "@/lib/verification/status";

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
        await setVerificationStatus(id, "VERIFIED", { adminId: admin.id, note: body.note });
        break;
      }
      case "request_more_info": {
        const items: string[] = Array.isArray(body.items) ? body.items : [];
        if (items.length === 0) throw new ApiError(400, "Select at least one item to request.");
        await setVerificationStatus(id, "VERIFICATION_REQUIRED", { adminId: admin.id, note: body.note, requestedInfoItems: items });
        break;
      }
      case "reject": {
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
        await setVerificationStatus(id, "RE_VERIFICATION_REQUIRED", { adminId: admin.id, reVerificationReason: body.reason, note: body.note });
        break;
      }
      case "assign": {
        if (admin.role !== "SUPER_ADMIN" && admin.role !== "ADMIN") throw new ApiError(403, "Only Super Admin/Admin can assign verifications.");
        await prisma.profileVerification.update({ where: { profileId: id }, data: { assignedToId: body.assignedToId || null } });
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
