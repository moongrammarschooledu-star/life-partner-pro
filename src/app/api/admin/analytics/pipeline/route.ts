import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { pipelineStatus } from "@/lib/analytics/pipeline";
import { runAnalyticsTick } from "@/lib/analytics/tick";
import { assertEnabled } from "@/lib/analytics/route-helpers";
import { marketingError, noStore } from "@/lib/marketing/route-utils";

export async function GET() {
  try {
    await requireAdmin("analytics:pipeline:view");
    return NextResponse.json(await pipelineStatus(), { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

// "Run now": the same steps as the daily job (refresh marts, data quality, reconciliation, alerts, scheduled reports).
export async function POST() {
  try {
    const admin = await requireAdmin("analytics:pipeline:manage");
    await assertEnabled("analytics.pipeline.enabled");
    return NextResponse.json(await runAnalyticsTick({ triggeredBy: admin.id }));
  } catch (error) {
    return marketingError(error);
  }
}
