import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { withRequestMetrics } from "@/lib/observability/metrics";
import { readJson } from "@/lib/ops/admin-route";
import { runAnalyticsAssistant } from "@/lib/ai/features";
import { outcomeResponse } from "@/lib/ai/route";

// Plain-language questions and the AI-assisted executive summary. The AI pipeline enforces ai:analytics:use, the feature flag, rollout,
// rate limits and the kill switch and audits the request. A question is translated into a validated structured query (never SQL) and
// run through the same permission checks as every dashboard.
const input = z.object({
  mode: z.enum(["QUESTION", "EXECUTIVE_SUMMARY"]),
  question: z.string().max(300).optional(),
  period: z.string().max(24).optional(),
});

async function postHandler(req: Request) {
  try {
    const admin = await requireAdmin();
    const parsed = input.safeParse(await readJson(req));
    if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    return outcomeResponse(await runAnalyticsAssistant(admin, parsed.data));
  } catch (error) {
    return handleApiError(error);
  }
}

export const POST = withRequestMetrics("POST /api/admin/analytics/assistant", postHandler);
