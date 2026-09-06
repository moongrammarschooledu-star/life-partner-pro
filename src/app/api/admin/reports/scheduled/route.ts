import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { computeNextRunAt } from "@/lib/reports/scheduler";
import { REPORT_DEFINITIONS, type DataSource } from "@/lib/reports/columns";
import type { ReportFrequency } from "@prisma/client";

// Spec §25 — Super Admin only.
export async function GET() {
  try {
    await requireAdmin("reports:schedule:manage");
    const items = await prisma.scheduledReport.findMany({
      include: { createdBy: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("reports:schedule:manage");
    const body = await req.json();
    const { name, reportKey, dataSource, filters, frequency, dayOfWeek, dayOfMonth, hourUtc, exportType, recipientAdminIds } = body as {
      name: string;
      reportKey: string;
      dataSource?: DataSource;
      filters?: Record<string, string>;
      frequency: ReportFrequency;
      dayOfWeek?: number;
      dayOfMonth?: number;
      hourUtc: number;
      exportType?: "CSV" | "EXCEL" | "PDF";
      recipientAdminIds: string[];
    };

    if (!name || !frequency || hourUtc == null || !Array.isArray(recipientAdminIds) || recipientAdminIds.length === 0) {
      throw new ApiError(400, "name, frequency, hourUtc, and at least one recipient are required");
    }
    if (dataSource && !REPORT_DEFINITIONS[dataSource]) throw new ApiError(400, "Invalid dataSource");

    const nextRunAt = computeNextRunAt(frequency, dayOfWeek ?? null, dayOfMonth ?? null, hourUtc, new Date());

    const scheduled = await prisma.scheduledReport.create({
      data: {
        name,
        reportKey: reportKey || "overview",
        dataSource: dataSource || null,
        filters: filters ?? {},
        frequency,
        dayOfWeek: dayOfWeek ?? null,
        dayOfMonth: dayOfMonth ?? null,
        hourUtc,
        exportType: exportType || "CSV",
        recipientAdminIds,
        nextRunAt,
        createdById: admin.id,
      },
    });

    await writeAudit({ action: "SCHEDULED_REPORT_CREATED", adminId: admin.id, meta: { scheduledReportId: scheduled.id, frequency, recipientCount: recipientAdminIds.length } });

    return NextResponse.json(scheduled);
  } catch (error) {
    return handleApiError(error);
  }
}
