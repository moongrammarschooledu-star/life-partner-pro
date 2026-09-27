import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { requestHoldRelease, executeHoldRelease } from "@/lib/compliance/legal-hold";

// STEP 23 Add-on §28 — releasing a legal hold now goes through the STEP 19
// maker-checker gate (LEGAL_HOLD_RELEASE) instead of a single admin
// unilaterally lifting it. requestHoldRelease() always records the request
// (holdStatus -> RELEASE_PENDING); executeHoldRelease() only runs once the
// gate is clear, which also covers the case where the action isn't
// configured to require approval at all.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("privacy:hold:manage");
    const { id } = await params;
    const { reason } = (await req.json().catch(() => ({}))) as { reason?: string };
    if (!reason?.trim()) throw new ApiError(400, "A reason is required to request release of a legal hold.");

    const requested = await requestHoldRelease(id, admin, reason.trim());
    if (requested.requiresApproval && requested.status !== "READY_TO_EXECUTE") {
      return NextResponse.json({ approvalRequired: true, approvalCode: requested.approvalCode, status: requested.status }, { status: 202 });
    }

    const hold = await executeHoldRelease(id, admin, requested.approvalRequestId);
    return NextResponse.json(hold);
  } catch (error) {
    return handleApiError(error);
  }
}
