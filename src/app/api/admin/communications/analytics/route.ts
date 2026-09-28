import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { analyticsToCsv, computeCommunicationAnalytics, parseAnalyticsRange } from "@/lib/communications/analytics";

// Aggregates only (no identifiers). A CSV export needs the separate export permission and is audited.
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const wantsCsv = q.get("format") === "csv";
    const admin = await requireAdmin("communications:analytics:view");
    if (wantsCsv && !admin.permissions.includes("communications:export")) throw new ApiError(403, "Forbidden: exporting needs the communications:export permission.");
    const range = parseAnalyticsRange(q.get("from"), q.get("to"));
    const analytics = await computeCommunicationAnalytics(range);
    if (wantsCsv) {
      await writeAudit({ action: "COMMUNICATION_LOG_VIEWED", adminId: admin.id, meta: { export: "analytics-csv", from: range.from.toISOString(), to: range.to.toISOString() } });
      return new NextResponse(analyticsToCsv(analytics), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=communication-analytics.csv", "cache-control": "no-store" } });
    }
    return NextResponse.json(analytics);
  } catch (error) {
    return handleApiError(error);
  }
}
