import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { withRequestMetrics } from "@/lib/observability/metrics";
import { readJson } from "@/lib/ops/admin-route";
import { matchExplanationInput } from "@/lib/ai/types";
import { runMatchExplanation } from "@/lib/ai/features";
import { outcomeResponse } from "@/lib/ai/route";

// Explain a match and analyse mutual requirements (spec §5-§9). The score itself comes only from the deterministic matcher.
async function postHandler(req: Request) {
  try {
    // Authentication + session only. The AI pipeline then enforces the ai:* permission, phase/flags/kill switch,
    // assignment scope, sensitive-field access and member consent, and audits every denial.
    const admin = await requireAdmin();
    const input = matchExplanationInput.safeParse(await readJson(req));
    if (!input.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    return outcomeResponse(await runMatchExplanation(admin, input.data));
  } catch (error) {
    return handleApiError(error);
  }
}

export const POST = withRequestMetrics("POST /api/admin/ai/match-explanation", postHandler);
