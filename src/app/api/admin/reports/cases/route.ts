import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { parseReportFilters } from "@/lib/reports/where-builders";
import { computeCasesReport } from "@/lib/reports/aggregate/cases";

export async function GET(req: Request) {
  try {
    await requireAdmin("cases:view");
    const filters = parseReportFilters(new URL(req.url).searchParams);
    return NextResponse.json(await computeCasesReport(filters));
  } catch (error) {
    return handleApiError(error);
  }
}
