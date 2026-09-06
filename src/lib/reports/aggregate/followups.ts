import { startOfDay, endOfDay } from "date-fns";
import { prisma } from "@/lib/prisma";
import { buildFollowUpWhere } from "@/lib/reports/where-builders";
import { safeRate } from "@/lib/reports/sample-size";
import type { ReportFilters } from "@/lib/reports/types";

// Spec §19.
export async function computeFollowUpAnalytics(filters: ReportFilters) {
  const where = buildFollowUpWhere(filters);
  const now = new Date();

  const [todayCount, completedCount, pendingCount, overdueCount, completedRows] = await Promise.all([
    prisma.followUp.count({ where: { ...where, dueDate: { gte: startOfDay(now), lte: endOfDay(now) } } }),
    prisma.followUp.count({ where: { ...where, status: "COMPLETED" } }),
    prisma.followUp.count({ where: { ...where, status: "PENDING" } }),
    prisma.followUp.count({ where: { ...where, status: "PENDING", dueDate: { lt: now } } }),
    prisma.followUp.findMany({ where: { ...where, status: "COMPLETED", completedAt: { not: null } }, select: { dueDate: true, completedAt: true } }),
  ]);

  const total = completedCount + pendingCount;
  const delaysHours = completedRows
    .map((r) => (r.completedAt!.getTime() - r.dueDate.getTime()) / (1000 * 60 * 60))
    .filter((h) => h > 0); // only count actually-late completions as "delay"

  return {
    today: todayCount,
    completed: completedCount,
    pending: pendingCount,
    overdue: overdueCount,
    completionRate: safeRate(completedCount, total),
    avgDelayHours: delaysHours.length > 0 ? Math.round(delaysHours.reduce((a, b) => a + b, 0) / delaysHours.length) : null,
  };
}
