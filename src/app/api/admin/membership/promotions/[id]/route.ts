import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { enforceApprovalGate, markApprovalExecuted } from "@/lib/approvals/gate";
import { setPromotionStatus } from "@/lib/promotions/promotion-service";
import type { PromotionLikeStatus } from "@prisma/client";

// STEP 27 §59 — activating a promotion goes through the maker-checker gate;
// policyRequiresApproval decides (via ApprovalPolicy/ApprovalAmountThreshold)
// whether THIS particular activation actually needs a second approver —
// every other transition is a plain RBAC-gated status move.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("promotions:manage");
    const { id } = await params;
    const { status, reason } = (await req.json()) as { status?: PromotionLikeStatus; reason?: string };
    if (!status) throw new ApiError(400, "A target status is required.");

    if (status === "ACTIVE") {
      const gate = await enforceApprovalGate({ actionType: "PROMOTION_APPROVAL", sourceType: "PAYMENT", sourceId: id, actor: admin, reason: reason ?? "Activate promotion", requestedPayload: { promotionId: id } });
      if (gate.requiresApproval && gate.status !== "READY_TO_EXECUTE") return NextResponse.json({ approvalRequired: true, approvalCode: gate.approvalCode, status: gate.status }, { status: 202 });
      const updated = await setPromotionStatus(admin.id, id, "ACTIVE", gate.requiresApproval ? admin.id : undefined);
      if (gate.requiresApproval) await markApprovalExecuted(gate.approvalRequestId, admin.id);
      return NextResponse.json({ approvalRequired: false, promotion: updated });
    }

    const updated = await setPromotionStatus(admin.id, id, status);
    return NextResponse.json({ promotion: updated });
  } catch (error) {
    return handleApiError(error);
  }
}
