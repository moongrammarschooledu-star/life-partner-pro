import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { runReport } from "@/lib/analytics/report-service";
import { assertEnabled, dbViewerFor } from "@/lib/analytics/route-helpers";
import { marketingError, noStore } from "@/lib/marketing/route-utils";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("analytics:reports:run");
    await assertEnabled("analytics.reports.enabled");
    const { id } = await params;
    const out = await runReport(await dbViewerFor(admin.id), { id });
    return NextResponse.json({ name: out.name, table: out.table, freshness: out.result.freshness, period: out.result.period, comparison: out.result.comparison }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}
