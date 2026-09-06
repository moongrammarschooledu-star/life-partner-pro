import { prisma } from "@/lib/prisma";
import { buildProfileWhere } from "@/lib/reports/where-builders";
import { assignRangeBucket, loadBucketConfig } from "@/lib/reports/buckets";
import type { ReportFilters } from "@/lib/reports/types";

// Spec §9 — income is sensitive; this function is only ever called from a
// route gated by reports:income:view (SUPER_ADMIN/ADMIN only). Aggregation
// only — individual income values are selected transiently for bucketing
// and never returned; only bucket counts leave this function.
export async function computeIncomeAnalytics(filters: ReportFilters) {
  const where = buildProfileWhere(filters);
  const buckets = await loadBucketConfig();

  const rows = await prisma.profile.findMany({
    where,
    select: { profession: { select: { monthlyIncome: true } } },
  });

  const bucketCounts = new Map<string, number>();
  for (const b of buckets.income) bucketCounts.set(b.label, 0);
  let disclosed = 0;
  for (const row of rows) {
    const income = row.profession?.monthlyIncome;
    if (income == null) continue;
    disclosed++;
    const label = assignRangeBucket(income, buckets.income);
    if (label) bucketCounts.set(label, (bucketCounts.get(label) ?? 0) + 1);
  }

  return {
    totalProfiles: rows.length,
    disclosedCount: disclosed,
    buckets: buckets.income.map((b) => ({ label: b.label, count: bucketCounts.get(b.label) ?? 0 })),
  };
}
