import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { withRequestMetrics } from "@/lib/observability/metrics";
import { readJson, requireReason, requireReauth } from "@/lib/ops/admin-route";
import { setKillSwitch } from "@/lib/ai/admin";

// AI kill switch (spec §59). ACTIVATING needs only a reason so it works in an emergency;
// DEACTIVATING needs password re-confirmation as well.
async function postHandler(req: Request) {
  try {
    const admin = await requireAdmin("ai:killswitch");
    const body = await readJson<{ active?: unknown; reason?: unknown; stepUpToken?: string }>(req);
    if (typeof body.active !== "boolean") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    const reason = requireReason(body.reason);
    if (!body.active) requireReauth(admin, body.stepUpToken, "re-enable AI assistance");
    return NextResponse.json(await setKillSwitch(admin, body.active, reason));
  } catch (error) {
    return handleApiError(error);
  }
}

export const POST = withRequestMetrics("POST /api/admin/ai/killswitch", postHandler);
