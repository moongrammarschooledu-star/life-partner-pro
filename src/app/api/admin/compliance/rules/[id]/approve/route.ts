import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { getRule, approveRule } from "@/lib/compliance/rules";

// STEP-19-gated (catalog: COMPLIANCE_RULE_APPROVAL) — moves UNDER_REVIEW ->
// APPROVED. Never also activates the rule (see plan decision 3). Existence
// and status are checked here (not left to approveRule's own plain Error)
// so a bad request maps to a proper 404/409 instead of a generic 500.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("compliance:rules:manage");
    const { id } = await params;
    const existing = await getRule(id);
    if (!existing) throw new ApiError(404, "Compliance rule not found");
    if (existing.status !== "UNDER_REVIEW") throw new ApiError(409, `Only an UNDER_REVIEW rule may be approved (current status: ${existing.status}).`);

    const { reason } = (await req.json().catch(() => ({}))) as { reason?: string };
    if (!reason?.trim()) throw new ApiError(400, "A reason is required to approve a compliance rule.");

    const result = await approveRule(id, admin, reason.trim());
    if (result.requiresApproval) {
      return NextResponse.json({ approvalRequired: true, approvalCode: result.approvalCode, status: result.status }, { status: 202 });
    }
    return NextResponse.json(result.rule);
  } catch (error) {
    return handleApiError(error);
  }
}
