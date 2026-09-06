import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { parseReportFilters } from "@/lib/reports/where-builders";
import { runCustomReport } from "@/lib/reports/custom-query";
import { REPORT_DEFINITIONS, type DataSource } from "@/lib/reports/columns";
import { buildCsv } from "@/lib/reports/export/csv";
import { buildExcelBuffer } from "@/lib/reports/export/excel";
import { buildPdfBuffer } from "@/lib/reports/export/pdf";
import { checkExportRateLimit } from "@/lib/reports/export-rate-limit";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";

const CONTENT_TYPES: Record<string, string> = {
  CSV: "text/csv",
  EXCEL: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  PDF: "application/pdf",
};

// Spec §23 — CSV/Excel/PDF export, role-permission-respecting. Rebuilt from
// the previous GET-only, filter-less, CSV-only version. Reuses
// runCustomReport() so the exported file is byte-identical in redaction to
// whatever the Custom Report Builder shows on screen for the same inputs.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("reports:export");
    if (!checkExportRateLimit(admin.id)) {
      throw new ApiError(429, "Export rate limit reached. Please try again later.");
    }

    const body = await req.json();
    const { dataSource, columns, filters: rawFilters, format, groupBy, sortBy } = body as {
      dataSource: DataSource;
      columns?: string[];
      filters?: Record<string, string>;
      format: "CSV" | "EXCEL" | "PDF";
      groupBy?: string;
      sortBy?: string;
    };

    if (!dataSource || !REPORT_DEFINITIONS[dataSource]) throw new ApiError(400, "A valid dataSource is required");
    if (!format || !CONTENT_TYPES[format]) throw new ApiError(400, "A valid format is required");

    const filters = parseReportFilters(new URLSearchParams(rawFilters ?? {}));
    const result = await runCustomReport(dataSource, filters, columns ?? [], admin.role, groupBy, sortBy);

    const columnDefs = result.columns as { key: string; label: string }[];
    let fileBuffer: Buffer | string;
    if (format === "CSV") {
      fileBuffer = buildCsv(columnDefs.map((c) => ({ ...c, sensitive: false })), result.rows);
    } else if (format === "EXCEL") {
      fileBuffer = await buildExcelBuffer(columnDefs.map((c) => ({ ...c, sensitive: false })), result.rows, dataSource);
    } else {
      fileBuffer = await buildPdfBuffer(columnDefs.map((c) => ({ ...c, sensitive: false })), result.rows, `${dataSource} Report`);
    }

    await prisma.reportExecution.create({
      data: {
        name: `${dataSource} export (${format})`,
        reportKey: "custom",
        dataSource,
        filters: rawFilters ?? {},
        columns: result.columns.map((c) => c.key),
        groupBy: groupBy || null,
        sortBy: sortBy || null,
        exportType: format,
        recordCount: result.recordCount,
        createdById: admin.id,
      },
    });
    await writeAudit({ action: "REPORT_EXPORTED", adminId: admin.id, meta: { dataSource, format, recordCount: result.recordCount } });

    const ext = format === "CSV" ? "csv" : format === "EXCEL" ? "xlsx" : "pdf";
    return new NextResponse(fileBuffer as never, {
      headers: {
        "Content-Type": CONTENT_TYPES[format],
        "Content-Disposition": `attachment; filename="${dataSource.toLowerCase()}-report.${ext}"`,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
