import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { withRequestMetrics } from "@/lib/observability/metrics";
import { readJson, requireReason, requireReauth } from "@/lib/ops/admin-route";
import { setKillSwitch } from "@/lib/ai/admin";
import { enforceApprovalGate, markApprovalExecuted } from "@/lib/approvals/gate";

// STEP 19 §18/§18 sourceId — the AI kill switch is a global singleton, not a
// per-record resource; a fixed synthetic id identifies it as a governed
// resource, same convention as the payment-rollout wiring.
const AI_GOVERNANCE_SOURCE_ID = "global-ai-config";

// AI kill switch (spec §59). ACTIVATING (blocking AI) needs only a reason so
// it works in an emergency — no approval gate, matching the existing
// emergency-speed intent. DEACTIVATING (re-enabling AI after a safety block)
// is the sensitive decision (spec §18: AI can never approve its own
// override) and additionally requires password re-confirmation AND
// maker-checker governance.
async function postHandler(req: Request) {
  try {
    const admin = await requireAdmin("ai:killswitch");
    const body = await readJson<{ active?: unknown; reason?: unknown; stepUpToken?: string }>(req);
    if (typeof body.active !== "boolean") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    const reason = requireReason(body.reason);

    let gate: Awaited<ReturnType<typeof enforceApprovalGate>> | null = null;
    if (!body.active) {
      requireReauth(admin, body.stepUpToken, "re-enable AI assistance");
      gate = await enforceApprovalGate({
        actionType: "AI_KILL_SWITCH_OVERRIDE",
        sourceType: "AI_SAFETY_EVENT",
        sourceId: AI_GOVERNANCE_SOURCE_ID,
        actor: admin,
        reason,
      });
      if (gate.requiresApproval && gate.status !== "READY_TO_EXECUTE") {
        return NextResponse.json({ approvalRequired: true, approvalCode: gate.approvalCode, status: gate.status }, { status: 202 });
      }
    }

    const result = await setKillSwitch(admin, body.active, reason);
    if (gate?.requiresApproval) await markApprovalExecuted(gate.approvalRequestId, admin.id);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}

export const POST = withRequestMetrics("POST /api/admin/ai/killswitch", postHandler);
