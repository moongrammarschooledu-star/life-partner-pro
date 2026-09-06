import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { parseReportFilters } from "@/lib/reports/where-builders";
import { computeIncomeAnalytics } from "@/lib/reports/aggregate/income";

// Spec §9 — income is sensitive; restricted to SUPER_ADMIN/ADMIN.
export async function GET(req: Request) {
  try {
    await requireAdmin("reports:income:view");
    const filters = parseReportFilters(new URL(req.url).searchParams);
    return NextResponse.json(await computeIncomeAnalytics(filters));
  } catch (error) {
    return handleApiError(error);
  }
}
