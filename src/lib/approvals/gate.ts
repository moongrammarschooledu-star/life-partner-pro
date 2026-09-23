import { requiresApproval as policyRequiresApproval, type ApprovalContext } from "@/lib/approvals/policy-engine";
import { createApprovalRequest, markApprovalExecuted } from "@/lib/approvals/engine";
import type { SessionAdmin } from "@/lib/route-guard";
import type { AssignmentResourceType } from "@prisma/client";

// STEP 19 architecture decision 2 — the blocking gate every existing
// high-risk route calls at the top of its handler, BEFORE performing its own
// mutation. It never reimplements a domain's mutation logic; it only decides
// go/no-go and creates/reuses the governing ApprovalRequest. The existing
// route stays the single source of truth for its own action.
export type GateStatus = "CREATED" | "ALREADY_PENDING" | "READY_TO_EXECUTE" | "CHANGES_REQUESTED" | "REJECTED" | "EXPIRED";

export type GateResult =
  | { requiresApproval: false }
  | { requiresApproval: true; status: GateStatus; approvalRequestId: string; approvalCode: string };

export interface EnforceApprovalGateParams {
  actionType: string;
  sourceType: AssignmentResourceType;
  sourceId: string;
  actor: SessionAdmin;
  reason: string;
  context?: ApprovalContext;
  currentStatePayload?: unknown;
  requestedPayload?: unknown;
}

// Usage at the top of an existing route (see the STEP 19 comment in each of
// the 8 wired routes/functions for a concrete example):
//
//   const gate = await enforceApprovalGate({ actionType: "PROFILE_SUSPEND", sourceType: "PROFILE", sourceId: profile.id, actor: admin, reason });
//   if (gate.requiresApproval && gate.status !== "READY_TO_EXECUTE") {
//     return NextResponse.json({ approvalRequired: true, approvalCode: gate.approvalCode, status: gate.status }, { status: 202 });
//   }
//   // ...existing mutation logic, unchanged...
//   if (gate.requiresApproval) await markApprovalExecuted(gate.approvalRequestId, admin.id);
export async function enforceApprovalGate(params: EnforceApprovalGateParams): Promise<GateResult> {
  const needsApproval = await policyRequiresApproval(params.actionType, params.context);
  if (!needsApproval) return { requiresApproval: false };

  const request = await createApprovalRequest({
    actionType: params.actionType,
    sourceType: params.sourceType,
    sourceId: params.sourceId,
    makerId: params.actor.id,
    reason: params.reason,
    context: params.context,
    currentStatePayload: params.currentStatePayload,
    requestedPayload: params.requestedPayload,
  });

  const status: GateStatus =
    request.status === "APPROVED" || request.status === "EXECUTION_PENDING" || request.status === "EXECUTING"
      ? "READY_TO_EXECUTE"
      : request.status === "CHANGES_REQUESTED"
        ? "CHANGES_REQUESTED"
        : request.status === "REJECTED"
          ? "REJECTED"
          : request.status === "EXPIRED"
            ? "EXPIRED"
            : request.status === "DRAFT" || request.status === "SUBMITTED" || request.status === "PENDING_REVIEW" || request.status === "PENDING_APPROVAL" || request.status === "PARTIALLY_APPROVED"
              ? "ALREADY_PENDING"
              : "ALREADY_PENDING";

  return { requiresApproval: true, status, approvalRequestId: request.id, approvalCode: request.approvalCode };
}

// Convenience re-export so gate call sites don't need a second import for
// the one follow-up call every wired route makes after its own mutation
// succeeds.
export { markApprovalExecuted };
