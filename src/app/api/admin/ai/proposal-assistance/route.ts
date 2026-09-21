import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { withRequestMetrics } from "@/lib/observability/metrics";
import { readJson } from "@/lib/ops/admin-route";
import { proposalAssistanceInput } from "@/lib/ai/types";
import { runProposalAssistance } from "@/lib/ai/features";
import { outcomeResponse } from "@/lib/ai/route";

// Internal neutral proposal preparation note; nothing is created or sent (spec §13).
async function postHandler(req: Request) {
  try {
    // Authentication + session only. The AI pipeline then enforces the ai:* permission, phase/flags/kill switch,
    // assignment scope, sensitive-field access and member consent, and audits every denial.
    const admin = await requireAdmin();
    const input = proposalAssistanceInput.safeParse(await readJson(req));
    if (!input.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    return outcomeResponse(await runProposalAssistance(admin, input.data));
  } catch (error) {
    return handleApiError(error);
  }
}

export const POST = withRequestMetrics("POST /api/admin/ai/proposal-assistance", postHandler);
