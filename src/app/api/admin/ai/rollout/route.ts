import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { withRequestMetrics } from "@/lib/observability/metrics";
import { z } from "zod";
import { readJson, requireReason, requireReauth } from "@/lib/ops/admin-route";
import { setRolloutPhase } from "@/lib/ai/admin";

// Rollout phases (spec §58): DISABLED → INTERNAL_TEST → STAFF_PILOT → LIMITED_PRODUCTION → PRODUCTION.
// One step at a time; any phase can return to DISABLED. Password re-confirmation and a reason are required.
const schema = z.object({ phase: z.enum(["DISABLED", "INTERNAL_TEST", "STAFF_PILOT", "LIMITED_PRODUCTION", "PRODUCTION"]) });

async function postHandler(req: Request) {
  try {
    const admin = await requireAdmin("ai:rollout:manage");
    const body = await readJson<{ phase?: unknown; reason?: unknown; stepUpToken?: string }>(req);
    const reason = requireReason(body.reason);
    requireReauth(admin, body.stepUpToken, "change the AI rollout phase");
    const parsed = schema.safeParse({ phase: body.phase });
    if (!parsed.success) return NextResponse.json({ error: "Invalid phase." }, { status: 400 });
    return NextResponse.json(await setRolloutPhase(admin, parsed.data.phase, reason));
  } catch (error) {
    return handleApiError(error);
  }
}

export const POST = withRequestMetrics("POST /api/admin/ai/rollout", postHandler);
