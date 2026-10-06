import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { HttpError } from "@/lib/http-error";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { exportReport, type ExportFormat } from "@/lib/analytics/report-service";
import { assertEnabled, dbViewerFor } from "@/lib/analytics/route-helpers";
import { marketingError, readBody } from "@/lib/marketing/route-utils";

// Export an unsaved definition (the builder's "download" button). Same checks as a saved report.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("analytics:reports:export");
    await assertEnabled("analytics.reports.enabled");
    const limited = await enforceConfiguredLimit(req, "analytics-export", { limit: 20, windowMs: 3_600_000 }, admin.id);
    if (limited) return limited;
    const b = await readBody(req, 20_000);
    const format = String(b.format ?? "csv") as ExportFormat;
    if (!["csv", "xlsx", "pdf"].includes(format)) throw new HttpError(400, "Unknown format.");
    const file = await exportReport(await dbViewerFor(admin.id), { definition: b.definition }, format);
    return new NextResponse(file.body as BodyInit, { headers: { "Content-Type": file.contentType, "Content-Disposition": `attachment; filename="${file.filename}"`, "Cache-Control": "no-store" } });
  } catch (error) {
    return marketingError(error);
  }
}
