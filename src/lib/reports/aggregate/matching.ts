import { prisma } from "@/lib/prisma";
import { buildMatchWhere, buildProfileWhere } from "@/lib/reports/where-builders";
import { safeRate } from "@/lib/reports/sample-size";
import type { ReportFilters } from "@/lib/reports/types";

// Spec §12/§13 — compatibility tiers use STEP 6's normalized score directly;
// never described anywhere as a guarantee of marriage.
function tierForScore(score: number): string {
  if (score >= 90) return "Excellent";
  if (score >= 80) return "Very Good";
  if (score >= 70) return "Good";
  if (score >= 60) return "Possible";
  return "Low";
}

export async function computeMatchingAnalytics(filters: ReportFilters) {
  const where = buildMatchWhere(filters);
  const [rows, profileCount, convertedCount] = await Promise.all([
    prisma.match.findMany({ where, select: { score: true, status: true, directionAToB: true, directionBToA: true } }),
    prisma.profile.count({ where: buildProfileWhere(filters) }),
    prisma.match.count({ where: { ...where, proposals: { some: {} } } }),
  ]);

  const total = rows.length;
  const reviewed = rows.filter((r) => r.status !== "SUGGESTED").length;

  const tierCounts: Record<string, number> = { Excellent: 0, "Very Good": 0, Good: 0, Possible: 0, Low: 0 };
  let scoreSum = 0;
  let mutualSum = 0;
  let mutualCount = 0;
  for (const r of rows) {
    tierCounts[tierForScore(r.score)]++;
    scoreSum += r.score;
    if (r.directionAToB && r.directionBToA) {
      mutualSum += Math.min(r.directionAToB, r.directionBToA);
      mutualCount++;
    }
  }

  return {
    total,
    reviewed,
    tiers: Object.entries(tierCounts).map(([label, count]) => ({ label, count })),
    avgScore: total > 0 ? Math.round(scoreSum / total) : null,
    avgMutualCompatibility: mutualCount > 0 ? Math.round(mutualSum / mutualCount) : null,
    matchesPerProfile: profileCount > 0 ? Math.round((total / profileCount) * 10) / 10 : null,
    adminReviewedCount: reviewed,
    convertedToProposals: convertedCount,
    conversionRate: safeRate(convertedCount, total),
  };
}
