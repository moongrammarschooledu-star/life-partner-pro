import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { withRequestMetrics } from "@/lib/observability/metrics";
import { activityList, activityFilterSchema } from "@/lib/ai/admin";

// AI Activity log (spec §68): metadata only. Prompt and result text are never stored in this table.
async function getHandler(req: Request) {
  try {
    await requireAdmin("ai:activity:view");
    const parsed = activityFilterSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!parsed.success) return NextResponse.json({ error: "Invalid filter." }, { status: 400 });
    return NextResponse.json(await activityList(parsed.data), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}

export const GET = withRequestMetrics("GET /api/admin/ai/activity", getHandler);
