import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { parseReportFilters } from "@/lib/reports/where-builders";
import { computeOutcomeAnalytics } from "@/lib/reports/aggregate/outcomes";

export async function GET(req: Request) {
  try {
    await requireAdmin("reports:view");
    const filters = parseReportFilters(new URL(req.url).searchParams);
    return NextResponse.json(await computeOutcomeAnalytics(filters));
  } catch (error) {
    return handleApiError(error);
  }
}
