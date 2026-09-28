import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { withRequestMetrics } from "@/lib/observability/metrics";
import { readJson } from "@/lib/ops/admin-route";
import { riskSummaryInput } from "@/lib/ai/types";
import { runRiskCaseSummary } from "@/lib/ai/features";
import { outcomeResponse } from "@/lib/ai/route";

// STEP 24 — metadata-only summary of a risk case. Built-in builder (no provider is called), visibility is the
// case's own, and the pipeline enforces ai:risk:use, flags, rollout, kill switch and audits every outcome.
async function postHandler(req: Request) {
  try {
    const admin = await requireAdmin();
    const input = riskSummaryInput.safeParse(await readJson(req));
    if (!input.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    return outcomeResponse(await runRiskCaseSummary(admin, input.data));
  } catch (error) {
    return handleApiError(error);
  }
}

export const POST = withRequestMetrics("POST /api/admin/ai/risk-summary", postHandler);
