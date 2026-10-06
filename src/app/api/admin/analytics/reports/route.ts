import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { REPORT_DATASETS, createReport, listReports } from "@/lib/analytics/report-service";
import { assertEnabled, dbViewerFor } from "@/lib/analytics/route-helpers";
import { marketingError, noStore, readBody, str } from "@/lib/marketing/route-utils";

export async function GET() {
  try {
    const admin = await requireAdmin("analytics:reports:view");
    await assertEnabled("analytics.reports.enabled");
    return NextResponse.json({ items: await listReports(await dbViewerFor(admin.id)), datasets: REPORT_DATASETS }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("analytics:reports:create");
    await assertEnabled("analytics.reports.enabled");
    const b = await readBody(req, 40_000);
    const vis = ["PRIVATE", "TEAM", "DEPARTMENT", "ORGANIZATION"].includes(String(b.visibility)) ? (b.visibility as "PRIVATE" | "TEAM" | "DEPARTMENT" | "ORGANIZATION") : "PRIVATE";
    const row = await createReport(admin, { name: str(b, "name", { required: true, max: 120 }), description: str(b, "description", { max: 300 }) || null, definition: b.definition, visibility: vis, visibilityValue: str(b, "visibilityValue", { max: 60 }) });
    return NextResponse.json({ id: row.id, code: row.code }, { status: 201 });
  } catch (error) {
    return marketingError(error);
  }
}
