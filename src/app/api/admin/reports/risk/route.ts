import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { enforcePersistentLimit } from "@/lib/ops/rate-limit-persistent";
import { computeRiskReport, parseRange, riskReportToCsv } from "@/lib/risk/report";

// STEP 24 - Risk & Safety report: aggregates only (no profile identifiers, contact data, free text or per-person
// scores). JSON needs risk:reports:view; the CSV export additionally needs risk:reports:export and is rate limited.
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("risk:reports:view");
    const sp = new URL(req.url).searchParams;
    const range = parseRange(sp.get("from"), sp.get("to"));
    if (sp.get("format") === "csv") {
      if (!admin.permissions.includes("risk:reports:export")) throw new ApiError(403, "Forbidden: insufficient permissions");
      const limited = await enforcePersistentLimit(req, "risk-report-export", 10, 600_000, admin.id);
      if (limited) return limited;
      const csv = riskReportToCsv(await computeRiskReport(range));
      return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="risk-report.csv"', "Cache-Control": "no-store" } });
    }
    return NextResponse.json(await computeRiskReport(range), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}
