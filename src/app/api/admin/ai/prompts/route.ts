import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { withRequestMetrics } from "@/lib/observability/metrics";
import { readJson, requireReason, requireReauth } from "@/lib/ops/admin-route";
import { listPrompts, approvePrompts } from "@/lib/ai/admin";

// Versioned prompt templates (spec §65/§66). Approval records the checksum of every template against the
// passing test run that allowed it; changing a template changes its checksum and invalidates the approval.
async function getHandler() {
  try {
    await requireAdmin("ai:config:manage");
    return NextResponse.json({ items: await listPrompts() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}

async function postHandler(req: Request) {
  try {
    const admin = await requireAdmin("ai:config:manage");
    const body = await readJson<{ reason?: unknown; stepUpToken?: string }>(req);
    const reason = requireReason(body.reason);
    requireReauth(admin, body.stepUpToken, "approve AI prompts");
    await approvePrompts(admin, reason);
    return NextResponse.json({ items: await listPrompts() });
  } catch (error) {
    return handleApiError(error);
  }
}

export const GET = withRequestMetrics("GET /api/admin/ai/prompts", getHandler);
export const POST = withRequestMetrics("POST /api/admin/ai/prompts", postHandler);
