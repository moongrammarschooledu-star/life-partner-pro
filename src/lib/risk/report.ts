import { prisma } from "@/lib/prisma";

// Risk & Safety report. Aggregates only — counts, ratios and durations. No profile
// identifier, contact detail, free text or per-person score is ever included, so the
// output (and its CSV export) is safe to share with reporting roles.

export interface RiskReport {
  period: { from: string; to: string };
  signalsByType: Record<string, number>;
  signalsByCategory: Record<string, number>;
  casesOpened: number;
  casesByStatus: Record<string, number>;
  casesByLevel: Record<string, number>;
  decisions: Record<string, number>;
  falsePositives: { total: number; byReason: Record<string, number>; rateOfDecided: number | null };
  meanHoursToFirstReview: number | null;
  duplicateClustersByStatus: Record<string, number>;
  restrictions: { applied: number; temporary: number; permanent: number; byType: Record<string, number> };
  technicalControls: number;
  userReports: { total: number; byType: Record<string, number>; byStatus: Record<string, number> };
  generatedAt: string;
}

function tally<T extends string | null>(rows: Array<{ key: T; n: number }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.key ?? "UNSPECIFIED"] = (out[r.key ?? "UNSPECIFIED"] ?? 0) + r.n;
  return out;
}

export function parseRange(from?: string | null, to?: string | null, now = new Date()): { from: Date; to: Date } {
  const end = to && !Number.isNaN(Date.parse(to)) ? new Date(to) : now;
  const start = from && !Number.isNaN(Date.parse(from)) ? new Date(from) : new Date(end.getTime() - 30 * 86_400_000);
  // Cap at one year so a report can never become an unbounded scan.
  const capped = end.getTime() - start.getTime() > 366 * 86_400_000 ? new Date(end.getTime() - 366 * 86_400_000) : start;
  return { from: capped, to: end };
}

export async function computeRiskReport(range: { from: Date; to: Date }): Promise<RiskReport> {
  const created = { gte: range.from, lte: range.to };
  const [byType, byCategory, cases, caseStatus, caseLevel, decisions, fpReasons, fpTotal, clusters, restrictions, controls, reportsByType, reportsByStatus, reviewedCases] = await Promise.all([
    prisma.securityFlag.groupBy({ by: ["flagType"], where: { createdAt: created, signalCode: { not: null } }, _count: { _all: true } }),
    prisma.securityFlag.groupBy({ by: ["category"], where: { createdAt: created, signalCode: { not: null } }, _count: { _all: true } }),
    prisma.riskCase.count({ where: { createdAt: created } }),
    prisma.riskCase.groupBy({ by: ["status"], where: { createdAt: created }, _count: { _all: true } }),
    prisma.riskCase.groupBy({ by: ["riskLevel"], where: { createdAt: created }, _count: { _all: true } }),
    prisma.riskReview.groupBy({ by: ["decision"], where: { createdAt: created }, _count: { _all: true } }),
    prisma.securityFlag.groupBy({ by: ["falsePositiveReason"], where: { status: "FALSE_POSITIVE", updatedAt: created }, _count: { _all: true } }),
    prisma.securityFlag.count({ where: { status: "FALSE_POSITIVE", updatedAt: created } }),
    prisma.duplicateCluster.groupBy({ by: ["status"], where: { createdAt: created }, _count: { _all: true } }),
    prisma.profileRestriction.findMany({ where: { source: "risk_case", createdAt: created }, select: { restrictionType: true, isPermanent: true }, take: 5000 }),
    prisma.securityIncident.count({ where: { createdAt: created } }),
    prisma.userReport.groupBy({ by: ["reportType"], where: { createdAt: created }, _count: { _all: true } }),
    prisma.userReport.groupBy({ by: ["status"], where: { createdAt: created }, _count: { _all: true } }),
    prisma.riskCase.findMany({ where: { createdAt: created }, select: { id: true, createdAt: true, reviews: { select: { createdAt: true }, orderBy: { createdAt: "asc" }, take: 1 } }, take: 500 }),
  ]);

  const decidedTotal = Object.entries(tally(caseStatus.map((r) => ({ key: r.status, n: r._count._all })))).filter(([k]) => ["CLEARED", "DISMISSED", "FALSE_POSITIVE", "CLOSED", "RESTRICTED", "SUSPENDED"].includes(k)).reduce((n, [, v]) => n + v, 0);
  const firstReviewHours = reviewedCases.filter((c) => c.reviews[0]).map((c) => (c.reviews[0].createdAt.getTime() - c.createdAt.getTime()) / 3_600_000);

  const byRestrictionType: Record<string, number> = {};
  for (const r of restrictions) byRestrictionType[r.restrictionType] = (byRestrictionType[r.restrictionType] ?? 0) + 1;

  return {
    period: { from: range.from.toISOString(), to: range.to.toISOString() },
    signalsByType: tally(byType.map((r) => ({ key: r.flagType, n: r._count._all }))),
    signalsByCategory: tally(byCategory.map((r) => ({ key: r.category, n: r._count._all }))),
    casesOpened: cases,
    casesByStatus: tally(caseStatus.map((r) => ({ key: r.status, n: r._count._all }))),
    casesByLevel: tally(caseLevel.map((r) => ({ key: r.riskLevel, n: r._count._all }))),
    decisions: tally(decisions.map((r) => ({ key: r.decision, n: r._count._all }))),
    falsePositives: {
      total: fpTotal,
      byReason: tally(fpReasons.map((r) => ({ key: r.falsePositiveReason, n: r._count._all }))),
      rateOfDecided: decidedTotal > 0 ? Math.round((fpTotal / decidedTotal) * 100) / 100 : null,
    },
    meanHoursToFirstReview: firstReviewHours.length ? Math.round((firstReviewHours.reduce((a, b) => a + b, 0) / firstReviewHours.length) * 10) / 10 : null,
    duplicateClustersByStatus: tally(clusters.map((r) => ({ key: r.status, n: r._count._all }))),
    restrictions: { applied: restrictions.length, temporary: restrictions.filter((r) => !r.isPermanent).length, permanent: restrictions.filter((r) => r.isPermanent).length, byType: byRestrictionType },
    technicalControls: controls,
    userReports: { total: Object.values(tally(reportsByType.map((r) => ({ key: r.reportType, n: r._count._all })))).reduce((a, b) => a + b, 0), byType: tally(reportsByType.map((r) => ({ key: r.reportType, n: r._count._all }))), byStatus: tally(reportsByStatus.map((r) => ({ key: r.status, n: r._count._all }))) },
    generatedAt: new Date().toISOString(),
  };
}

function csvCell(value: string | number | null): string {
  const s = value === null ? "" : String(value);
  // Neutralise spreadsheet-formula injection as well as quoting.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function riskReportToCsv(report: RiskReport): string {
  const rows: Array<[string, string, string | number | null]> = [];
  const add = (section: string, map: Record<string, number>) => Object.entries(map).forEach(([k, v]) => rows.push([section, k, v]));
  add("signals_by_type", report.signalsByType);
  add("signals_by_category", report.signalsByCategory);
  add("cases_by_status", report.casesByStatus);
  add("cases_by_level", report.casesByLevel);
  add("review_decisions", report.decisions);
  add("false_positive_reasons", report.falsePositives.byReason);
  add("duplicate_clusters", report.duplicateClustersByStatus);
  add("restrictions_by_type", report.restrictions.byType);
  add("user_reports_by_type", report.userReports.byType);
  add("user_reports_by_status", report.userReports.byStatus);
  rows.push(["summary", "cases_opened", report.casesOpened]);
  rows.push(["summary", "false_positive_rate_of_decided", report.falsePositives.rateOfDecided]);
  rows.push(["summary", "mean_hours_to_first_review", report.meanHoursToFirstReview]);
  rows.push(["summary", "technical_controls", report.technicalControls]);
  rows.push(["summary", "restrictions_temporary", report.restrictions.temporary]);
  rows.push(["summary", "restrictions_permanent", report.restrictions.permanent]);
  return ["section,metric,value", ...rows.map((r) => r.map(csvCell).join(","))].join("\n") + "\n";
}
