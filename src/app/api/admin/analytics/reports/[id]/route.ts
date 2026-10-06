import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { getReport, updateReport } from "@/lib/analytics/report-service";
import { assertEnabled, dbViewerFor } from "@/lib/analytics/route-helpers";
import { marketingError, noStore, readBody, str } from "@/lib/marketing/route-utils";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("analytics:reports:view");
    await assertEnabled("analytics.reports.enabled");
    const { id } = await params;
    const { report, definition } = await getReport(await dbViewerFor(admin.id), id);
    return NextResponse.json({ id: report.id, code: report.code, name: report.name, description: report.description, visibility: report.visibility, status: report.status, version: report.currentVersion, definition }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("analytics:reports:edit");
    await assertEnabled("analytics.reports.enabled");
    const { id } = await params;
    const b = await readBody(req, 40_000);
    const vis = ["PRIVATE", "TEAM", "DEPARTMENT", "ORGANIZATION"].includes(String(b.visibility)) ? (b.visibility as "PRIVATE" | "TEAM" | "DEPARTMENT" | "ORGANIZATION") : undefined;
    const row = await updateReport(admin, id, { name: b.name === undefined ? undefined : str(b, "name", { max: 120 }), description: b.description === undefined ? undefined : str(b, "description", { max: 300 }) || null, definition: b.definition, visibility: vis, visibilityValue: str(b, "visibilityValue", { max: 60 }), status: b.status === "ARCHIVED" ? "ARCHIVED" : b.status === "ACTIVE" ? "ACTIVE" : undefined });
    return NextResponse.json({ id: row.id, version: row.currentVersion, visibility: row.visibility, status: row.status });
  } catch (error) {
    return marketingError(error);
  }
}
