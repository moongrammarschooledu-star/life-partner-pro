import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { computeNextRunAt } from "@/lib/reports/scheduler";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("reports:schedule:manage");
    const { id } = await params;
    const body = await req.json();

    const existing = await prisma.scheduledReport.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "Not found");

    const { active, recipientAdminIds, frequency, dayOfWeek, dayOfMonth, hourUtc } = body as {
      active?: boolean;
      recipientAdminIds?: string[];
      frequency?: "DAILY" | "WEEKLY" | "MONTHLY";
      dayOfWeek?: number;
      dayOfMonth?: number;
      hourUtc?: number;
    };

    const nextFrequency = frequency ?? existing.frequency;
    const nextDayOfWeek = dayOfWeek ?? existing.dayOfWeek;
    const nextDayOfMonth = dayOfMonth ?? existing.dayOfMonth;
    const nextHourUtc = hourUtc ?? existing.hourUtc;
    const scheduleChanged = frequency !== undefined || dayOfWeek !== undefined || dayOfMonth !== undefined || hourUtc !== undefined;

    const updated = await prisma.scheduledReport.update({
      where: { id },
      data: {
        ...(active !== undefined ? { active } : {}),
        ...(Array.isArray(recipientAdminIds) ? { recipientAdminIds } : {}),
        ...(frequency ? { frequency } : {}),
        ...(dayOfWeek !== undefined ? { dayOfWeek } : {}),
        ...(dayOfMonth !== undefined ? { dayOfMonth } : {}),
        ...(hourUtc !== undefined ? { hourUtc } : {}),
        ...(scheduleChanged ? { nextRunAt: computeNextRunAt(nextFrequency, nextDayOfWeek, nextDayOfMonth, nextHourUtc, new Date()) } : {}),
      },
    });

    await writeAudit({ action: "SCHEDULED_REPORT_UPDATED", adminId: admin.id, meta: { scheduledReportId: id } });

    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("reports:schedule:manage");
    const { id } = await params;
    // Soft-disable rather than hard delete — keeps the audit trail of who
    // configured what intact (spec §25's recipient-authorization framing).
    await prisma.scheduledReport.update({ where: { id }, data: { active: false } });
    await writeAudit({ action: "SCHEDULED_REPORT_UPDATED", adminId: admin.id, meta: { scheduledReportId: id, disabled: true } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
