import { prisma } from "@/lib/prisma";
import { ACTIVE_CASE_STATUSES } from "@/lib/risk/case-service";
import type { RiskLevel } from "@prisma/client";

// SafetyIntelligenceService — read-only aggregates for the Risk & Safety Center
// dashboard, reports and KPIs. Counts and ratios only: no profile-identifying
// data leaves this module, so it can safely feed exports and AI summaries.

export interface RiskOverview {
  openCasesByLevel: Record<RiskLevel, number>;
  openCases: number;
  overdueCases: number;
  openSignals: number;
  signalsByCategory: Record<string, number>;
  unresolvedDuplicateClusters: number;
  activeTechnicalControls: number;
  reportsLast7Days: number;
  reviewedLast30Days: number;
  falsePositiveRate: number | null; // FALSE_POSITIVE / all reviewed-and-closed decisions, last 30 days
  averageOpenAgeHours: number | null;
  generatedAt: string;
}

export async function getRiskOverview(now = new Date()): Promise<RiskOverview> {
  const since30 = new Date(now.getTime() - 30 * 86_400_000);
  const since7 = new Date(now.getTime() - 7 * 86_400_000);
  const [openCases, overdueCases, openSignals, categories, clusters, controls, reports, decided] = await Promise.all([
    prisma.riskCase.findMany({ where: { status: { in: ACTIVE_CASE_STATUSES } }, select: { riskLevel: true, createdAt: true } }),
    prisma.riskCase.count({ where: { status: { in: ACTIVE_CASE_STATUSES }, dueAt: { lt: now } } }),
    prisma.securityFlag.count({ where: { status: { in: ["OPEN", "INVESTIGATING", "ACKNOWLEDGED", "ESCALATED"] } } }),
    prisma.securityFlag.groupBy({ by: ["category"], where: { status: { in: ["OPEN", "INVESTIGATING", "ACKNOWLEDGED", "ESCALATED"] } }, _count: { _all: true } }),
    prisma.duplicateCluster.count({ where: { status: "UNRESOLVED" } }),
    prisma.securityIncident.count({ where: { status: "ACTIVE", expiresAt: { gt: now } } }),
    prisma.userReport.count({ where: { createdAt: { gte: since7 } } }),
    prisma.riskCase.groupBy({ by: ["status"], where: { closedAt: { gte: since30 } }, _count: { _all: true } }),
  ]);

  const byLevel: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  for (const c of openCases) byLevel[c.riskLevel]++;
  const signalsByCategory: Record<string, number> = {};
  for (const row of categories) signalsByCategory[row.category ?? "UNCATEGORIZED"] = row._count._all;

  const decidedTotal = decided.reduce((n, d) => n + d._count._all, 0);
  const falsePositives = decided.find((d) => d.status === "FALSE_POSITIVE")?._count._all ?? 0;
  const avgAge = openCases.length ? openCases.reduce((sum, c) => sum + (now.getTime() - c.createdAt.getTime()), 0) / openCases.length / 3_600_000 : null;

  return {
    openCasesByLevel: byLevel,
    openCases: openCases.length,
    overdueCases,
    openSignals,
    signalsByCategory,
    unresolvedDuplicateClusters: clusters,
    activeTechnicalControls: controls,
    reportsLast7Days: reports,
    reviewedLast30Days: decidedTotal,
    falsePositiveRate: decidedTotal > 0 ? Math.round((falsePositives / decidedTotal) * 100) / 100 : null,
    averageOpenAgeHours: avgAge === null ? null : Math.round(avgAge),
    generatedAt: now.toISOString(),
  };
}

export const SafetyIntelligenceService = { overview: getRiskOverview };
