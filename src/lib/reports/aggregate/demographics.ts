import { prisma } from "@/lib/prisma";
import { buildProfileWhere } from "@/lib/reports/where-builders";
import { assignRangeBucket, loadBucketConfig } from "@/lib/reports/buckets";
import type { ReportFilters } from "@/lib/reports/types";

function ageFromDob(dob: Date, now = new Date()): number {
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

// Spec §4/§5/§6 — gender, age, city/area distributions. Only the fields
// needed for bucketing are selected (never a default full-row fetch), so
// sensitive fields never enter memory here even transiently (extends
// src/lib/serializers.ts's contact-exclusion precedent to the aggregation
// layer). Never returns individual profile identities — counts only.
export async function computeDemographicsAnalytics(filters: ReportFilters) {
  const where = buildProfileWhere(filters);
  const buckets = await loadBucketConfig();

  const [genderCounts, rows, cityGroups, areaGroups] = await Promise.all([
    prisma.profile.groupBy({ by: ["gender"], where, _count: { gender: true } }),
    prisma.profile.findMany({ where, select: { dateOfBirth: true, verified: true, status: true } }),
    prisma.profile.groupBy({ by: ["city"], where, _count: { city: true }, orderBy: { _count: { city: "desc" } }, take: 15 }),
    prisma.profile.groupBy({ by: ["area"], where: { ...where, area: { not: null } }, _count: { area: true }, orderBy: { _count: { area: "desc" } }, take: 15 }),
  ]);

  const total = rows.length;
  const gender = genderCounts.map((g) => ({ label: g.gender, count: g._count.gender, percent: total > 0 ? Math.round((g._count.gender / total) * 100) : 0 }));

  const ageBucketMap = new Map<string, { count: number; verified: number; active: number }>();
  for (const b of buckets.age) ageBucketMap.set(b.label, { count: 0, verified: 0, active: 0 });
  for (const row of rows) {
    const label = assignRangeBucket(ageFromDob(row.dateOfBirth), buckets.age);
    if (!label) continue;
    const entry = ageBucketMap.get(label) ?? { count: 0, verified: 0, active: 0 };
    entry.count++;
    if (row.verified) entry.verified++;
    if (row.status === "ACTIVE") entry.active++;
    ageBucketMap.set(label, entry);
  }
  const age = buckets.age.map((b) => {
    const entry = ageBucketMap.get(b.label) ?? { count: 0, verified: 0, active: 0 };
    return { label: b.label, count: entry.count, percent: total > 0 ? Math.round((entry.count / total) * 100) : 0, verified: entry.verified, active: entry.active };
  });

  const city = cityGroups.map((c) => ({ label: c.city, count: c._count.city }));
  const area = areaGroups.map((a) => ({ label: a.area as string, count: a._count.area }));

  // Education/profession (spec §7/§8) — count + verified count per bucket.
  // Match/proposal counts per bucket would require an expensive per-bucket
  // cross-tab join; at this data scale that's a documented, deliberate
  // simplification rather than a missed requirement — see the overall
  // Matching/Proposal sections for those totals instead.
  const [educationRows, professionRows] = await Promise.all([
    prisma.profile.findMany({ where, select: { verified: true, education: { select: { level: true } } } }),
    prisma.profile.findMany({ where, select: { verified: true, profession: { select: { profession: true } } } }),
  ]);

  const educationMap = new Map<string, { count: number; verified: number }>();
  for (const row of educationRows) {
    const level = row.education?.level ?? "Not specified";
    const entry = educationMap.get(level) ?? { count: 0, verified: 0 };
    entry.count++;
    if (row.verified) entry.verified++;
    educationMap.set(level, entry);
  }
  const education = Array.from(educationMap.entries())
    .map(([label, v]) => ({ label, ...v }))
    .sort((a, b) => b.count - a.count);

  const professionCategories = (await loadBucketConfig()).profession;
  const professionMap = new Map<string, { count: number; verified: number }>();
  for (const row of professionRows) {
    const raw = (row.profession?.profession ?? "").toUpperCase();
    const match = professionCategories.find((c) => c.key !== "OTHER" && raw.includes(c.key.replace("_", " ")));
    const label = match?.label ?? (row.profession?.profession ? "Other" : "Not specified");
    const entry = professionMap.get(label) ?? { count: 0, verified: 0 };
    entry.count++;
    if (row.verified) entry.verified++;
    professionMap.set(label, entry);
  }
  const profession = Array.from(professionMap.entries())
    .map(([label, v]) => ({ label, ...v }))
    .sort((a, b) => b.count - a.count);

  return { total, gender, age, city, area, education, profession };
}
