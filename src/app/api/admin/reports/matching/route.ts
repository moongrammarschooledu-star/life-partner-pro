import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { parseReportFilters } from "@/lib/reports/where-builders";
import { computeMatchingAnalytics, computeSearchAnalytics } from "@/lib/reports/aggregate/matching";

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("reports:view");
    const filters = parseReportFilters(new URL(req.url).searchParams);
    const matching = await computeMatchingAnalytics(filters);
    // STEP 20 §46 — only attached for a caller who can also see search
    // activity at all; aggregate counts only, never raw filter values.
    const search = admin.permissions.includes("search:view") ? await computeSearchAnalytics(filters) : null;
    return NextResponse.json({ ...matching, search });
  } catch (error) {
    return handleApiError(error);
  }
}
