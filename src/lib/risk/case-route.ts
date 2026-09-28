import { NextResponse } from "next/server";
import { ApiError, type SessionAdmin } from "@/lib/route-guard";
import { requireReason, requireReauth } from "@/lib/ops/admin-route";
import { applyCaseAction, type CaseActionResult, type RiskCaseAction } from "@/lib/risk/case-service";
import type { FalsePositiveReason, RiskCase } from "@prisma/client";

// Shared request handling for the /api/admin/risk/cases/[id]/<action> routes. Each route file still
// calls requireAdmin(<its own permission>) itself; this only parses/validates the body and turns the
// service result into a response. All rules (state machine, checklist, approval gate, human actor)
// live in case-service.ts — a route can never bypass them.

const FALSE_POSITIVE_REASONS: FalsePositiveReason[] = [
  "SHARED_FAMILY_DEVICE", "SHARED_FAMILY_PHONE", "SHARED_HOME_NETWORK", "DATA_ENTRY_ERROR", "PROVIDER_ERROR", "LEGITIMATE_DUPLICATE_CONTEXT", "INCORRECT_SIGNAL", "OTHER",
];

export interface CaseActionBody {
  reason?: unknown;
  notes?: unknown;
  checklist?: unknown;
  falsePositiveReason?: unknown;
  restrictionTypes?: unknown;
  endDate?: unknown;
  permanent?: unknown;
  outcome?: unknown;
  decision?: unknown;
  stepUpToken?: string;
}

function str(v: unknown, max = 1000): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
}

export function parseCaseActionBody(body: CaseActionBody) {
  let falsePositiveReason: FalsePositiveReason | undefined;
  if (body.falsePositiveReason !== undefined) {
    if (!FALSE_POSITIVE_REASONS.includes(body.falsePositiveReason as FalsePositiveReason)) throw new ApiError(400, "Invalid false-positive reason.");
    falsePositiveReason = body.falsePositiveReason as FalsePositiveReason;
  }
  let restrictionTypes: string[] | undefined;
  if (body.restrictionTypes !== undefined) {
    if (!Array.isArray(body.restrictionTypes) || body.restrictionTypes.some((t) => typeof t !== "string") || body.restrictionTypes.length > 12) throw new ApiError(400, "restrictionTypes must be a list of names.");
    restrictionTypes = body.restrictionTypes as string[];
  }
  let endDate: Date | null | undefined;
  if (body.endDate !== undefined && body.endDate !== null && body.endDate !== "") {
    const d = new Date(String(body.endDate));
    if (Number.isNaN(d.getTime())) throw new ApiError(400, "Invalid end date.");
    endDate = d;
  }
  const checklist = body.checklist && typeof body.checklist === "object" && !Array.isArray(body.checklist) ? (body.checklist as Record<string, unknown>) : undefined;
  return {
    reason: str(body.reason, 500),
    notes: str(body.notes, 2000),
    checklist,
    falsePositiveReason,
    restrictionTypes,
    endDate,
    permanent: body.permanent === true,
    outcome: str(body.outcome, 500),
  };
}

export function caseDto(c: RiskCase) {
  return { id: c.id, riskCode: c.riskCode, status: c.status, riskLevel: c.riskLevel, riskState: c.riskState, category: c.category, title: c.title, dueAt: c.dueAt, updatedAt: c.updatedAt };
}

export async function runCaseAction(caseId: string, actor: SessionAdmin, action: RiskCaseAction, body: CaseActionBody, opts: { reauth?: boolean; requireReasonText?: boolean } = {}): Promise<CaseActionResult> {
  if (opts.requireReasonText) requireReason(body.reason ?? body.notes);
  if (opts.reauth) requireReauth(actor, body.stepUpToken, "perform this action");
  const parsed = parseCaseActionBody(body);
  return applyCaseAction(caseId, { action, actor, ...parsed });
}

// 202 while an approval is pending (same contract as the other gated admin routes), 200 once applied.
export function caseActionResponse(result: CaseActionResult): NextResponse {
  if (result.approvalRequired) return NextResponse.json({ approvalRequired: true, approvalCode: result.approvalCode, status: result.status, case: caseDto(result.riskCase) }, { status: 202 });
  return NextResponse.json({ approvalRequired: false, case: caseDto(result.riskCase) });
}
