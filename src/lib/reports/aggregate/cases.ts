import { prisma } from "@/lib/prisma";
import type { ReportFilters } from "@/lib/reports/types";

// Spec §38 — a dedicated Cases report tab (mirroring STEP 11's
// team-workload.ts precedent) rather than a Custom Report Builder data
// source: Cases needs per-type-permission and staff-conduct visibility
// rules the generic builder doesn't model for any existing source, so
// wiring it in halfway would be riskier than a standalone, purpose-built
// aggregate. Sensitive figures (reporter/reported identity) are never
// included here — this is counts and durations only.
export async function computeCasesReport(filters: ReportFilters) {
  const { from, to } = filters.dateRange;
  const where = { createdAt: { gte: from, lte: to } };

  const [byCategory, byStatus, byPriority, byType, resolutions, allInRange, reopenedCount] = await Promise.all([
    prisma.case.groupBy({ by: ["category"], where, _count: { category: true } }),
    prisma.case.groupBy({ by: ["status"], where, _count: { status: true } }),
    prisma.case.groupBy({ by: ["priority"], where, _count: { priority: true } }),
    prisma.case.groupBy({ by: ["type"], where, _count: { type: true } }),
    prisma.caseResolution.groupBy({ by: ["category"], where: { case: where }, _count: { category: true } }),
    prisma.case.findMany({ where, select: { id: true, status: true, resolutionDueAt: true, firstResponseDueAt: true, firstRespondedAt: true, createdAt: true, resolution: { select: { createdAt: true } } } }),
    prisma.caseStatusHistory.count({ where: { toStatus: "REOPENED", createdAt: { gte: from, lte: to } } }),
  ]);

  const closedCount = allInRange.filter((c) => c.status === "CLOSED" || c.status === "RESOLVED").length;
  const openCount = allInRange.length - closedCount;
  const escalatedCount = allInRange.filter((c) => c.status === "ESCALATED").length;

  // Historical pass/fail against each case's own SLA deadline — a resolved
  // case is compliant if it was resolved by its resolutionDueAt; a still-open
  // case is compliant only if "now" hasn't passed its deadline yet.
  const now = new Date();
  let slaOnTime = 0, slaOverdueCount = 0, slaTotal = 0;
  const resolutionDurationsHours: number[] = [];
  const firstResponseDurationsHours: number[] = [];
  for (const c of allInRange) {
    if (c.resolutionDueAt) {
      slaTotal++;
      const measuredAt = c.resolution?.createdAt ?? now;
      if (measuredAt.getTime() > c.resolutionDueAt.getTime()) slaOverdueCount++;
      else slaOnTime++;
    }
    if (c.resolution) {
      resolutionDurationsHours.push((c.resolution.createdAt.getTime() - c.createdAt.getTime()) / (1000 * 60 * 60));
    }
    if (c.firstRespondedAt) {
      firstResponseDurationsHours.push((c.firstRespondedAt.getTime() - c.createdAt.getTime()) / (1000 * 60 * 60));
    }
  }
  const avg = (arr: number[]) => (arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);

  return {
    byCategory: byCategory.map((c) => ({ label: c.category, count: c._count.category })),
    byStatus: byStatus.map((s) => ({ label: s.status, count: s._count.status })),
    byPriority: byPriority.map((p) => ({ label: p.priority, count: p._count.priority })),
    byType: byType.map((t) => ({ label: t.type, count: t._count.type })),
    byResolutionCategory: resolutions.map((r) => ({ label: r.category, count: r._count.category })),
    totalCases: allInRange.length,
    openCases: openCount,
    closedCases: closedCount,
    escalatedCases: escalatedCount,
    reopenedCases: reopenedCount,
    escalationRate: allInRange.length > 0 ? Math.round((escalatedCount / allInRange.length) * 100) : null,
    slaCompliance: slaTotal >= 5 ? Math.round((slaOnTime / slaTotal) * 100) : null,
    slaOverdueCount,
    avgFirstResponseHours: avg(firstResponseDurationsHours),
    avgResolutionHours: avg(resolutionDurationsHours),
  };
}
