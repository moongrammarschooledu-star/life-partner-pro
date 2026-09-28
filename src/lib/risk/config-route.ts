import { NextResponse } from "next/server";
import { enforceApprovalGate, markApprovalExecuted } from "@/lib/approvals/gate";
import { requireReason, requireReauth } from "@/lib/ops/admin-route";
import type { SessionAdmin } from "@/lib/route-guard";

// Shared gate handling for the rule / factor / threshold change routes. A configuration change is ALWAYS
// versioned (a new row, never an in-place edit), needs a written reason and password re-confirmation, and goes
// through the STEP 19 maker-checker gate: the first call creates the approval request (202); once it is approved
// the same call applies the change and marks the approval executed.
export async function gatedConfigChange<T>(params: {
  admin: SessionAdmin;
  actionType: "RISK_RULE_CHANGE" | "RISK_THRESHOLD_CHANGE";
  sourceId: string;
  reason: unknown;
  stepUpToken: string | undefined;
  what: string;
  requestedPayload: unknown;
  apply: () => Promise<T>;
}): Promise<NextResponse> {
  const reason = requireReason(params.reason);
  requireReauth(params.admin, params.stepUpToken, params.what);
  const gate = await enforceApprovalGate({
    actionType: params.actionType,
    sourceType: "CASE",
    sourceId: params.sourceId,
    actor: params.admin,
    reason,
    requestedPayload: params.requestedPayload,
  });
  if (gate.requiresApproval && gate.status !== "READY_TO_EXECUTE") {
    return NextResponse.json({ approvalRequired: true, approvalCode: gate.approvalCode, status: gate.status }, { status: 202 });
  }
  const result = await params.apply();
  if (gate.requiresApproval) await markApprovalExecuted(gate.approvalRequestId, params.admin.id);
  return NextResponse.json({ approvalRequired: false, result });
}
