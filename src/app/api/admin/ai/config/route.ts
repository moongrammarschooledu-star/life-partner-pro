import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { withRequestMetrics } from "@/lib/observability/metrics";
import { readJson, requireReason, requireReauth } from "@/lib/ops/admin-route";
import { getConfigView, updateConfig, configPatchSchema } from "@/lib/ai/admin";

// AI Settings (spec §22/§56). Secrets are never stored or returned; changing the provider, model,
// storage policy or external access additionally needs a fresh passing AI test run (spec §66).
async function getHandler() {
  try {
    await requireAdmin("ai:config:manage");
    return NextResponse.json(await getConfigView(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}

async function patchHandler(req: Request) {
  try {
    const admin = await requireAdmin("ai:config:manage");
    const body = await readJson<{ values?: unknown; reason?: unknown; stepUpToken?: string }>(req);
    const reason = requireReason(body.reason);
    requireReauth(admin, body.stepUpToken, "change AI settings");
    const parsed = configPatchSchema.safeParse(body.values);
    if (!parsed.success) return NextResponse.json({ error: "Invalid settings.", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 400 });
    return NextResponse.json(await updateConfig(admin, parsed.data, reason));
  } catch (error) {
    return handleApiError(error);
  }
}

export const GET = withRequestMetrics("GET /api/admin/ai/config", getHandler);
export const PATCH = withRequestMetrics("PATCH /api/admin/ai/config", patchHandler);
