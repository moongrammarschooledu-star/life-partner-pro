import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { enforceApprovalGate, markApprovalExecuted } from "@/lib/approvals/gate";
import { setPackageVersionStatus } from "@/lib/finance/package-version-service";

// STEP 27 §5/§14 — moving a version to ACTIVE (a feature/limit-set change,
// possibly alongside a price change) is gated by the maker-checker flow;
// every other transition (submit for approval, reject) is a plain RBAC-
// gated status move.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  try {
    const admin = await requireAdmin("finance:packages:manage");
    const { id, versionId } = await params;
    const { status, reason } = (await req.json()) as { status?: "PENDING_APPROVAL" | "APPROVED" | "ACTIVE" | "REJECTED"; reason?: string };
    if (!status) throw new ApiError(400, "A target status is required.");

    if (status === "ACTIVE") {
      const gate = await enforceApprovalGate({
        actionType: "PACKAGE_VERSION_ACTIVATION",
        sourceType: "PAYMENT",
        sourceId: versionId,
        actor: admin,
        reason: reason ?? "Activate package version",
        requestedPayload: { packageId: id, versionId },
      });
      if (gate.requiresApproval && gate.status !== "READY_TO_EXECUTE") return NextResponse.json({ approvalRequired: true, approvalCode: gate.approvalCode, status: gate.status }, { status: 202 });
      const updated = await setPackageVersionStatus(admin.id, versionId, "ACTIVE", gate.requiresApproval ? admin.id : undefined);
      if (gate.requiresApproval) await markApprovalExecuted(gate.approvalRequestId, admin.id);
      return NextResponse.json({ approvalRequired: false, version: updated });
    }

    const updated = await setPackageVersionStatus(admin.id, versionId, status);
    return NextResponse.json({ version: updated });
  } catch (error) {
    return handleApiError(error);
  }
}
