import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { runReport } from "@/lib/analytics/report-service";
import { assertEnabled, dbViewerFor } from "@/lib/analytics/route-helpers";
import { marketingError, noStore, readBody } from "@/lib/marketing/route-utils";

// Run an unsaved definition (the report builder's preview) as the signed-in admin.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("analytics:reports:run");
    await assertEnabled("analytics.reports.enabled");
    const b = await readBody(req, 20_000);
    const out = await runReport(await dbViewerFor(admin.id), { definition: b.definition });
    return NextResponse.json({ table: out.table, freshness: out.result.freshness, period: out.result.period, comparison: out.result.comparison }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}
