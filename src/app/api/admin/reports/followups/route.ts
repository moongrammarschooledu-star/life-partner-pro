import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { parseReportFilters } from "@/lib/reports/where-builders";
import { computeFollowUpAnalytics } from "@/lib/reports/aggregate/followups";

export async function GET(req: Request) {
  try {
    await requireAdmin("reports:view");
    const filters = parseReportFilters(new URL(req.url).searchParams);
    return NextResponse.json(await computeFollowUpAnalytics(filters));
  } catch (error) {
    return handleApiError(error);
  }
}
