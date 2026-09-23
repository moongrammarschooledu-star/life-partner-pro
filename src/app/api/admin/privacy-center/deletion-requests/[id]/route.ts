import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { reviewDeletionRequest } from "@/lib/privacy/deletion-request";
import { enforceApprovalGate, markApprovalExecuted } from "@/lib/approvals/gate";

// Spec §14 step 5-6 — admin review. "decision: approve" schedules execution
// (a cooling-off period, default 7 days) rather than deleting immediately;
// "decision: reject" reverts the account to ACTIVE.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("privacy:delete:manage");
    const { id } = await params;
    const { decision, mode, rejectionReason, coolingOffDays } = await req.json();

    if (decision !== "approve" && decision !== "reject") throw new Error("decision must be 'approve' or 'reject'.");

    // STEP 19 §15 — maker-checker gate on the approval decision itself
    // (the active-hold re-check lives inside reviewDeletionRequest()'s
    // approve branch, run again at execution time regardless of approval).
    let gate: Awaited<ReturnType<typeof enforceApprovalGate>> | null = null;
    if (decision === "approve") {
      const request = await prisma.accountDeletionRequest.findUnique({ where: { id }, select: { profileId: true, requestCode: true } });
      if (!request) throw new ApiError(404, "Deletion request not found.");
      gate = await enforceApprovalGate({
        actionType: "DELETION_APPROVAL",
        sourceType: "PRIVACY_REQUEST",
        sourceId: id,
        actor: admin,
        reason: `Approve deletion request ${request.requestCode}.`,
        requestedPayload: { mode: mode ?? null, coolingOffDays: coolingOffDays ?? null },
      });
      if (gate.requiresApproval && gate.status !== "READY_TO_EXECUTE") {
        return NextResponse.json({ approvalRequired: true, approvalCode: gate.approvalCode, status: gate.status }, { status: 202 });
      }
    }

    const updated = await reviewDeletionRequest({ requestId: id, adminId: admin.id, decision, mode, rejectionReason, coolingOffDays });
    if (gate?.requiresApproval) await markApprovalExecuted(gate.approvalRequestId, admin.id);
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
