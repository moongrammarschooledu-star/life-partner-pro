import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { parseReportFilters } from "@/lib/reports/where-builders";
import { runCustomReport } from "@/lib/reports/custom-query";
import type { DataSource } from "@/lib/reports/columns";

// Spec §24 — "allow admins to regenerate" a stored report using its saved
// filters/columns/group-by/sort-by.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("reports:view");
    const { id } = await params;

    const execution = await prisma.reportExecution.findUnique({ where: { id } });
    if (!execution || !execution.dataSource) throw new ApiError(404, "Report not found or not regenerable");

    const filters = parseReportFilters(new URLSearchParams((execution.filters as Record<string, string>) ?? {}));
    const columns = Array.isArray(execution.columns) ? (execution.columns as string[]) : [];
    const result = await runCustomReport(execution.dataSource as DataSource, filters, columns, admin.role, execution.groupBy ?? undefined, execution.sortBy ?? undefined);

    await writeAudit({ action: "REPORT_REGENERATED", adminId: admin.id, meta: { reportExecutionId: id } });

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
