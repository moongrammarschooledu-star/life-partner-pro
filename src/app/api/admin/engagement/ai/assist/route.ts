import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { withRequestMetrics } from "@/lib/observability/metrics";
import { readJson } from "@/lib/ops/admin-route";
import { runEngagementAssistant } from "@/lib/ai/features";
import { outcomeResponse } from "@/lib/ai/route";

// Summaries / reminder drafts / content topics. The AI pipeline enforces ai:engagement:use, the feature flag, rollout and the
// kill switch and audits the request; the builder is a fixed phrase library - it cannot send, schedule, approve or decide anything.
const input = z.object({
  mode: z.enum(["JOURNEY_SUMMARY", "NEXT_ACTION_EXPLANATION", "REMINDER_DRAFT", "CONTENT_SUGGESTION", "FEEDBACK_SUMMARY", "ANALYTICS_SUMMARY"]),
  language: z.enum(["EN", "UR"]).optional(),
  crmRecordId: z.string().max(40).optional(),
  reminderKind: z.string().max(40).optional(),
  days: z.number().int().min(1).max(365).optional(),
});

async function postHandler(req: Request) {
  try {
    const admin = await requireAdmin();
    const parsed = input.safeParse(await readJson(req));
    if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    return outcomeResponse(await runEngagementAssistant(admin, parsed.data));
  } catch (error) {
    return handleApiError(error);
  }
}

export const POST = withRequestMetrics("POST /api/admin/engagement/ai/assist", postHandler);
