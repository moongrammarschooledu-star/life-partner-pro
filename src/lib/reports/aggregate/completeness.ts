import { prisma } from "@/lib/prisma";
import { buildProfileWhere } from "@/lib/reports/where-builders";
import type { ReportFilters } from "@/lib/reports/types";

// Spec §11 — reuses the already-stored Profile.profileCompletion (STEP 8's
// src/lib/verification/completeness.ts, kept in sync at registration and
// after OTP verification) rather than re-deriving it per profile.
export async function computeCompletenessAnalytics(filters: ReportFilters) {
  const where = buildProfileWhere(filters);
  const rows = await prisma.profile.findMany({ where, select: { profileCompletion: true } });

  const total = rows.length;
  const average = total > 0 ? Math.round(rows.reduce((sum, r) => sum + r.profileCompletion, 0) / total) : null;

  const buckets = { above90: 0, from70to89: 0, from50to69: 0, below50: 0 };
  for (const r of rows) {
    const pct = r.profileCompletion;
    if (pct >= 90) buckets.above90++;
    else if (pct >= 70) buckets.from70to89++;
    else if (pct >= 50) buckets.from50to69++;
    else buckets.below50++;
  }

  return { total, average, buckets };
}

// "Incomplete Profiles Report" (spec §11) — identifies specific profiles
// below a threshold for admin follow-up targeting.
export async function listIncompleteProfiles(filters: ReportFilters, threshold = 70, page = 1, pageSize = 20) {
  const where = { ...buildProfileWhere(filters), profileCompletion: { lt: threshold } };
  const [total, items] = await Promise.all([
    prisma.profile.count({ where }),
    prisma.profile.findMany({
      where,
      select: { id: true, profileCode: true, fullName: true, city: true, status: true, profileCompletion: true, createdAt: true },
      orderBy: { profileCompletion: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { total, items, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
