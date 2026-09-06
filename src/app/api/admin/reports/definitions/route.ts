import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { REPORT_DEFINITIONS, getReportColumns, type DataSource } from "@/lib/reports/columns";

// Exposes the whitelisted Custom Report Builder registry to the client,
// already redacted per the caller's role (spec §22/§23).
export async function GET() {
  try {
    const admin = await requireAdmin("reports:view");
    const definitions = Object.fromEntries(
      (Object.keys(REPORT_DEFINITIONS) as DataSource[]).map((dataSource) => [
        dataSource,
        {
          columns: getReportColumns(dataSource, admin.role),
          filterableFields: REPORT_DEFINITIONS[dataSource].filterableFields,
          groupByFields: REPORT_DEFINITIONS[dataSource].groupByFields,
          sortByFields: REPORT_DEFINITIONS[dataSource].sortByFields,
        },
      ])
    );
    return NextResponse.json({ definitions });
  } catch (error) {
    return handleApiError(error);
  }
}
