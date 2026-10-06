import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { listIssues, qualitySummary, runDataQualityChecks, CHECKS } from "@/lib/analytics/data-quality";
import { assertEnabled } from "@/lib/analytics/route-helpers";
import { marketingError, noStore, readBody } from "@/lib/marketing/route-utils";

export async function GET(req: Request) {
  try {
    await requireAdmin("analytics:data_quality:view");
    await assertEnabled();
    const status = new URL(req.url).searchParams.get("status") ?? undefined;
    return NextResponse.json({ summary: await qualitySummary(), items: await listIssues({ status }), checks: CHECKS.map((c) => ({ key: c.key, label: c.label, severity: c.severity })) }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

export async function POST(req: Request) {
  try {
    await requireAdmin("analytics:data_quality:manage");
    await assertEnabled("analytics.pipeline.enabled");
    await readBody(req);
    return NextResponse.json(await runDataQualityChecks());
  } catch (error) {
    return marketingError(error);
  }
}
