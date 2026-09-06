import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { parseReportFilters } from "@/lib/reports/where-builders";
import { runCustomReport } from "@/lib/reports/custom-query";
import { REPORT_DEFINITIONS, type DataSource } from "@/lib/reports/columns";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";

// Spec §22 — Custom Report Builder. Whitelisted against REPORT_DEFINITIONS;
// no raw SQL or arbitrary field names ever reach a query.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("reports:view");
    const body = await req.json();
    const { dataSource, columns, filters: rawFilters, groupBy, sortBy } = body as {
      dataSource: DataSource;
      columns?: string[];
      filters?: Record<string, string>;
      groupBy?: string;
      sortBy?: string;
    };

    if (!dataSource || !REPORT_DEFINITIONS[dataSource]) throw new ApiError(400, "A valid dataSource is required");

    const params = new URLSearchParams(rawFilters ?? {});
    const filters = parseReportFilters(params);

    const result = await runCustomReport(dataSource, filters, columns ?? [], admin.role, groupBy, sortBy);

    await prisma.reportExecution.create({
      data: {
        name: `Custom: ${dataSource}`,
        reportKey: "custom",
        dataSource,
        filters: rawFilters ?? {},
        columns: result.columns.map((c) => c.key),
        groupBy: groupBy || null,
        sortBy: sortBy || null,
        recordCount: result.recordCount,
        createdById: admin.id,
      },
    });
    await writeAudit({ action: "REPORT_GENERATED", adminId: admin.id, meta: { dataSource, recordCount: result.recordCount } });

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
