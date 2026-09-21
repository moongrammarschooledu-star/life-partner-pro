import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { withRequestMetrics } from "@/lib/observability/metrics";
import { overview } from "@/lib/ai/admin";

// AI overview: phase, provider, health, today's usage, latest test run.
async function getHandler() {
  try {
    await requireAdmin("ai:view");
    return NextResponse.json(await overview(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}

export const GET = withRequestMetrics("GET /api/admin/ai/overview", getHandler);
