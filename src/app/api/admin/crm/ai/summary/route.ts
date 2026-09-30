import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { withRequestMetrics } from "@/lib/observability/metrics";
import { readJson } from "@/lib/ops/admin-route";
import { runCrmSummary } from "@/lib/ai/features";
import { outcomeResponse } from "@/lib/ai/route";
import { z } from "zod";

// STEP 28 §60/§61 — applicant summary and next-action suggestions in one
// response (the suggestedNextStep/data.suggestions fields already answer
// "next action" — a disclosed simplification over a second AiFeature/route
// for what the same pure builder already returns).
const crmSummaryInput = z.object({ crmRecordId: z.string().min(1), mode: z.enum(["applicant", "timeline"]).optional() });

async function postHandler(req: Request) {
  try {
    const admin = await requireAdmin();
    const input = crmSummaryInput.safeParse(await readJson(req));
    if (!input.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    return outcomeResponse(await runCrmSummary(admin, input.data));
  } catch (error) {
    return handleApiError(error);
  }
}

export const POST = withRequestMetrics("POST /api/admin/crm/ai/summary", postHandler);
