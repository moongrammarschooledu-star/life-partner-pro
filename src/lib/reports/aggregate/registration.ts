import { prisma } from "@/lib/prisma";
import { buildProfileWhere } from "@/lib/reports/where-builders";
import { bucketByDay, bucketByDayMultiSeries } from "@/lib/reports/day-bucketing";
import type { ReportFilters } from "@/lib/reports/types";

// Spec §3 — registration trend + new-vs-verified/active/rejected multi-series.
// "New" = every profile created in the window; verified/active/rejected are
// classified by CURRENT status, not a historical snapshot at registration
// time (this codebase has no profile-status history table), so a profile
// registered mid-window that has since been verified counts in both series —
// documented here since spec §28 requires each KPI's logic be explicit.
export async function computeRegistrationAnalytics(filters: ReportFilters) {
  const where = buildProfileWhere(filters);
  const rows = await prisma.profile.findMany({
    where,
    select: { createdAt: true, status: true, verified: true },
  });

  const dailyTrend = bucketByDay(rows, (r) => r.createdAt);

  const statusSeries = bucketByDayMultiSeries(
    rows,
    (r) => r.createdAt,
    (r) => (r.verified ? "verified" : r.status === "REJECTED" ? "rejected" : r.status === "ACTIVE" ? "active" : "new")
  );

  return {
    totalInRange: rows.length,
    dailyTrend,
    newVsVerifiedVsActiveVsRejected: statusSeries,
  };
}
