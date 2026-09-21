import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { withRequestMetrics } from "@/lib/observability/metrics";
import { readJson } from "@/lib/ops/admin-route";
import { dataQualityInput } from "@/lib/ai/types";
import { runDataQuality } from "@/lib/ai/features";
import { outcomeResponse } from "@/lib/ai/route";

// Missing / inconsistent / needs-verification findings and improvement suggestions (spec §10-§12, §48).
async function postHandler(req: Request) {
  try {
    // Authentication + session only. The AI pipeline then enforces the ai:* permission, phase/flags/kill switch,
    // assignment scope, sensitive-field access and member consent, and audits every denial.
    const admin = await requireAdmin();
    const input = dataQualityInput.safeParse(await readJson(req));
    if (!input.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    return outcomeResponse(await runDataQuality(admin, input.data));
  } catch (error) {
    return handleApiError(error);
  }
}

export const POST = withRequestMetrics("POST /api/admin/ai/data-quality", postHandler);
