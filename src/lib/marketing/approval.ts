import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { seedApprovalPolicies } from "@/lib/approvals/catalog";
import { enforceApprovalGate, type GateResult } from "@/lib/approvals/gate";
import type { SessionAdmin } from "@/lib/route-guard";

// STEP 29 — the STEP 19 gate FAILS OPEN when no ApprovalPolicy row exists (requiresApproval() returns false for a
// missing policy), and policies are only seeded when an admin opens the approval-policies screen. Marketing therefore
// seeds its policies (and budget tiers) idempotently before every gate, AND the campaign state machine independently
// enforces approver ≠ author, so a deleted/disabled policy can never silently open a launch or budget increase.

// Minor units of PKR (paisa). Tiers escalate the required level; the base policy is LEVEL_1 so an increase with no
// matching tier (or another currency) still needs a second person.
const BUDGET_TIERS = [
  { minAmountMinor: 0, maxAmountMinor: 5_000_000, requiredLevel: "LEVEL_1" as const, minimumApprovers: 1 },
  { minAmountMinor: 5_000_001, maxAmountMinor: 50_000_000, requiredLevel: "LEVEL_2" as const, minimumApprovers: 1 },
  { minAmountMinor: 50_000_001, maxAmountMinor: null, requiredLevel: "LEVEL_3" as const, minimumApprovers: 2 },
];

let ensured = false;

export async function ensureMarketingApprovalPolicies(): Promise<void> {
  if (ensured) return;
  await seedApprovalPolicies();
  const existing = await prisma.approvalAmountThreshold.count({ where: { actionType: "MARKETING_BUDGET_INCREASE", currencyCode: "PKR" } });
  if (existing === 0) {
    await prisma.approvalAmountThreshold.createMany({
      data: BUDGET_TIERS.map((t) => ({ actionType: "MARKETING_BUDGET_INCREASE", currencyCode: "PKR", ...t })),
    });
  }
  ensured = true;
}

export function resetMarketingApprovalSetupForTests(): void {
  ensured = false;
}

// TOCTOU guard: an approval authorises exactly the payload that was requested (content hash, budget, version ids).
// When a request comes back READY_TO_EXECUTE, the live values must still match what the checker approved — otherwise
// the content changed after approval and a fresh request is required.
export async function assertApprovedPayloadMatches(approvalRequestId: string, expected: Record<string, string | number | null>): Promise<void> {
  const req = await prisma.approvalRequest.findUnique({ where: { id: approvalRequestId }, select: { requestedPayload: true } });
  const approved = (req?.requestedPayload ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(expected)) {
    if (approved[key] !== value) throw new HttpError(409, "This item changed after it was approved. Submit it again for approval.");
  }
}

export async function gateMarketingAction(params: {
  actionType: "MARKETING_CAMPAIGN_LAUNCH" | "MARKETING_BUDGET_INCREASE" | "MARKETING_PROVIDER_CONNECTION_CHANGE" | "MARKETING_LANDING_PAGE_PUBLISH" | "MARKETING_LEAD_EXPORT";
  sourceId: string;
  actor: SessionAdmin;
  reason: string;
  context?: { amountMinor?: number; currencyCode?: string };
  requestedPayload?: Record<string, unknown>;
  currentStatePayload?: Record<string, unknown>;
}): Promise<GateResult> {
  await ensureMarketingApprovalPolicies();
  return enforceApprovalGate({
    actionType: params.actionType,
    sourceType: "CASE",
    sourceId: params.sourceId,
    actor: params.actor,
    reason: params.reason,
    context: params.context,
    requestedPayload: params.requestedPayload,
    currentStatePayload: params.currentStatePayload,
  });
}
