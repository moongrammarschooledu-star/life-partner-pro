import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { parseReportFilters } from "@/lib/reports/where-builders";
import { computeFinanceReport } from "@/lib/reports/aggregate/finance";

export async function GET(req: Request) {
  try {
    await requireAdmin("finance:reports:view");
    const filters = parseReportFilters(new URL(req.url).searchParams);
    return NextResponse.json(await computeFinanceReport(filters));
  } catch (error) {
    return handleApiError(error);
  }
}
