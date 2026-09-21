import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { withRequestMetrics } from "@/lib/observability/metrics";
import { readJson } from "@/lib/ops/admin-route";
import { followUpInput } from "@/lib/ai/types";
import { runFollowUpDraft } from "@/lib/ai/features";
import { outcomeResponse } from "@/lib/ai/route";

// Suggest follow-up actions and a draft. Never sends or completes anything (spec §15).
async function postHandler(req: Request) {
  try {
    // Authentication + session only. The AI pipeline then enforces the ai:* permission, phase/flags/kill switch,
    // assignment scope, sensitive-field access and member consent, and audits every denial.
    const admin = await requireAdmin();
    const input = followUpInput.safeParse(await readJson(req));
    if (!input.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    return outcomeResponse(await runFollowUpDraft(admin, input.data));
  } catch (error) {
    return handleApiError(error);
  }
}

export const POST = withRequestMetrics("POST /api/admin/ai/followup-draft", postHandler);
