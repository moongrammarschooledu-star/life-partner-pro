import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { parseReportFilters } from "@/lib/reports/where-builders";
import { computeOverview } from "@/lib/reports/aggregate/overview";

// The Reports & Analytics Overview endpoint (spec §2) — KPI cards with
// prior-period comparison + registration trend. Every other section lives
// in its own sibling route (see src/app/api/admin/reports/*) so switching
// tabs doesn't recompute all of them.
export async function GET(req: Request) {
  try {
    await requireAdmin("reports:view");
    const filters = parseReportFilters(new URL(req.url).searchParams);
    const data = await computeOverview(filters);
    return NextResponse.json(data);
  } catch (error) {
    return handleApiError(error);
  }
}
