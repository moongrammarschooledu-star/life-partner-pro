import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { withRequestMetrics } from "@/lib/observability/metrics";
import { usageReport } from "@/lib/ai/admin";

// AI Usage & Cost: cost is an estimate and only shown when the provider reports usage and a price is configured.
async function getHandler(req: Request) {
  try {
    await requireAdmin("ai:usage:view");
    const days = Math.min(365, Math.max(1, Number(new URL(req.url).searchParams.get("days") ?? 30) || 30));
    return NextResponse.json(await usageReport(days), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}

export const GET = withRequestMetrics("GET /api/admin/ai/usage", getHandler);
