import { seedApprovalPolicies } from "@/lib/approvals/catalog";
import { enforceApprovalGate, type GateResult } from "@/lib/approvals/gate";
import { assertApprovedPayloadMatches } from "@/lib/marketing/approval";
import type { SessionAdmin } from "@/lib/route-guard";

// STEP 30 — the STEP 19 gate FAILS OPEN when no ApprovalPolicy row exists (and rows are only seeded when an admin opens the
// approval-policies screen). Engagement therefore seeds the catalog idempotently before every gate, exactly as marketing
// does, and ALSO enforces author != reviewer in the services, so a deleted or disabled policy can never silently open a publish.

let ensured = false;

export async function ensureEngagementApprovalPolicies(): Promise<void> {
  if (ensured) return;
  await seedApprovalPolicies();
  ensured = true;
}

export function resetEngagementApprovalSetupForTests(): void {
  ensured = false;
}

export type EngagementGatedAction = "ENGAGEMENT_WORKFLOW_PUBLISH" | "ENGAGEMENT_CONTENT_PUBLISH" | "ENGAGEMENT_ANNOUNCEMENT_PUBLISH";

export async function gateEngagementAction(params: {
  actionType: EngagementGatedAction;
  sourceId: string;
  actor: SessionAdmin;
  reason: string;
  requestedPayload?: Record<string, unknown>;
  currentStatePayload?: Record<string, unknown>;
}): Promise<GateResult> {
  await ensureEngagementApprovalPolicies();
  return enforceApprovalGate({
    actionType: params.actionType,
    sourceType: "CASE",
    sourceId: params.sourceId,
    actor: params.actor,
    reason: params.reason,
    requestedPayload: params.requestedPayload,
    currentStatePayload: params.currentStatePayload,
  });
}

// An approval authorises exactly the payload that was requested (content hash, version): a change after approval is refused.
export { assertApprovedPayloadMatches };
