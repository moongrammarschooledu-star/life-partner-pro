import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { withRequestMetrics } from "@/lib/observability/metrics";
import { readJson } from "@/lib/ops/admin-route";
import { runMarketingAssistant } from "@/lib/ai/features";
import { outcomeResponse } from "@/lib/ai/route";

// Copy drafts / aggregate summaries. The AI pipeline enforces ai:marketing:use, the feature flag, rollout and the kill
// switch and audits the request; the builder itself is a fixed phrase library — it cannot launch, spend or send.
const input = z.object({
  mode: z.enum(["HEADLINES", "DESCRIPTIONS", "CTAS", "FAQ", "LANDING_INTRO", "CAMPAIGN_SUMMARY", "ANALYTICS_SUMMARY", "LEAD_FOLLOWUP"]),
  language: z.enum(["EN", "UR"]).optional(),
  objective: z.string().max(60).optional(),
  campaignId: z.string().max(40).optional(),
  leadFirstName: z.string().max(40).optional(),
});

async function postHandler(req: Request) {
  try {
    const admin = await requireAdmin();
    const parsed = input.safeParse(await readJson(req));
    if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    return outcomeResponse(await runMarketingAssistant(admin, parsed.data));
  } catch (error) {
    return handleApiError(error);
  }
}

export const POST = withRequestMetrics("POST /api/admin/marketing/ai/assist", postHandler);
