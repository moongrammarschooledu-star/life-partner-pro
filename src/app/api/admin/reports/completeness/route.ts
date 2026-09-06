import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { parseReportFilters } from "@/lib/reports/where-builders";
import { computeCompletenessAnalytics, listIncompleteProfiles } from "@/lib/reports/aggregate/completeness";

export async function GET(req: Request) {
  try {
    await requireAdmin("reports:view");
    const { searchParams } = new URL(req.url);
    const filters = parseReportFilters(searchParams);
    const includeIncomplete = searchParams.get("incomplete") === "true";
    const page = Math.max(1, Number(searchParams.get("page") ?? "1"));

    const summary = await computeCompletenessAnalytics(filters);
    if (!includeIncomplete) return NextResponse.json({ summary });

    const incomplete = await listIncompleteProfiles(filters, 70, page);
    return NextResponse.json({ summary, incomplete });
  } catch (error) {
    return handleApiError(error);
  }
}
