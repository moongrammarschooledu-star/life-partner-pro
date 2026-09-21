import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { withRequestMetrics } from "@/lib/observability/metrics";
import { readJson } from "@/lib/ops/admin-route";
import { copilotInput } from "@/lib/ai/types";
import { runCopilot } from "@/lib/ai/copilot/copilot";
import { resolveProfileRef } from "@/lib/ai/features";
import { outcomeResponse } from "@/lib/ai/route";

// Admin Copilot (spec §16, §43): read/draft only, permission-bound tools.
async function postHandler(req: Request) {
  try {
    const admin = await requireAdmin(); // the pipeline enforces ai:copilot, phase/flags and consent
    const input = copilotInput.safeParse(await readJson(req));
    if (!input.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    let context: string | undefined;
    if (input.data.profileId) {
      const id = await resolveProfileRef(input.data.profileId);
      if (!id) return NextResponse.json({ ok: false, code: "FORBIDDEN", error: "You do not have access to this profile." }, { status: 403 });
      context = id;
    }
    return outcomeResponse(await runCopilot(admin, input.data.message, context));
  } catch (error) {
    return handleApiError(error);
  }
}

export const POST = withRequestMetrics("POST /api/admin/ai/copilot", postHandler);
