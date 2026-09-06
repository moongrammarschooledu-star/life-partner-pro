import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { parseReportFilters } from "@/lib/reports/where-builders";
import { computeStaffPerformance } from "@/lib/reports/aggregate/staff-performance";

// Spec §18 — Super Admin only.
export async function GET(req: Request) {
  try {
    await requireAdmin("reports:staff-performance:view");
    const filters = parseReportFilters(new URL(req.url).searchParams);
    return NextResponse.json(await computeStaffPerformance(filters));
  } catch (error) {
    return handleApiError(error);
  }
}
