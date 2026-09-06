import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { parseReportFilters } from "@/lib/reports/where-builders";
import { computeRegistrationAnalytics } from "@/lib/reports/aggregate/registration";

export async function GET(req: Request) {
  try {
    await requireAdmin("reports:view");
    const filters = parseReportFilters(new URL(req.url).searchParams);
    return NextResponse.json(await computeRegistrationAnalytics(filters));
  } catch (error) {
    return handleApiError(error);
  }
}
