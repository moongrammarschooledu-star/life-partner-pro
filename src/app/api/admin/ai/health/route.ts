import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { withRequestMetrics } from "@/lib/observability/metrics";
import { healthReport } from "@/lib/ai/admin";

// AI Health: real request counts only; no rate is invented when there is no traffic.
async function getHandler() {
  try {
    await requireAdmin("ai:view");
    return NextResponse.json(await healthReport(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}

export const GET = withRequestMetrics("GET /api/admin/ai/health", getHandler);
