import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { withRequestMetrics } from "@/lib/observability/metrics";
import { readJson } from "@/lib/ops/admin-route";
import { reportInput } from "@/lib/ai/types";
import { runReportSummary } from "@/lib/ai/features";
import { outcomeResponse } from "@/lib/ai/route";

// Restate figures from existing reports; nothing is estimated (spec §46).
async function postHandler(req: Request) {
  try {
    // Authentication + session only. The AI pipeline then enforces the ai:* permission, phase/flags/kill switch,
    // assignment scope, sensitive-field access and member consent, and audits every denial.
    const admin = await requireAdmin();
    const input = reportInput.safeParse(await readJson(req));
    if (!input.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    return outcomeResponse(await runReportSummary(admin, input.data));
  } catch (error) {
    return handleApiError(error);
  }
}

export const POST = withRequestMetrics("POST /api/admin/ai/report-summary", postHandler);
