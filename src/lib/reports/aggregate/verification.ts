import { prisma } from "@/lib/prisma";
import { buildVerificationWhere, buildProfileWhere } from "@/lib/reports/where-builders";
import { safeRate } from "@/lib/reports/sample-size";
import type { ReportFilters } from "@/lib/reports/types";

// Spec §10. Verification turnaround = lastReviewedAt − createdAt, averaged
// over VERIFIED/REJECTED rows in the filtered window. Caveat (documented per
// spec §28): this is only an accurate "time to decision" if lastReviewedAt
// is set exclusively at the final verified/rejected transition rather than
// on every intermediate review touch — see src/lib/verification/status.ts's
// setVerificationStatus(), which does set it on every transition, so this
// number should be read as "time since last status change", not strictly
// "time to first decision" for profiles that passed through multiple states.
export async function computeVerificationAnalytics(filters: ReportFilters) {
  const where = buildVerificationWhere(filters);

  const [countByStatus, decidedRows, suspendedCount] = await Promise.all([
    prisma.profileVerification.groupBy({ by: ["status"], where, _count: { status: true } }),
    prisma.profileVerification.findMany({
      where: { ...where, status: { in: ["VERIFIED", "VERIFICATION_REJECTED"] }, lastReviewedAt: { not: null } },
      select: { status: true, createdAt: true, lastReviewedAt: true },
    }),
    prisma.profile.count({ where: { ...buildProfileWhere(filters), status: "SUSPENDED" } }),
  ]);

  const counts = Object.fromEntries(countByStatus.map((c) => [c.status, c._count.status]));
  const total = countByStatus.reduce((sum, c) => sum + c._count.status, 0);

  const turnaroundMs = decidedRows.map((r) => r.lastReviewedAt!.getTime() - r.createdAt.getTime());
  const avgTurnaroundHours = turnaroundMs.length > 0 ? Math.round(turnaroundMs.reduce((a, b) => a + b, 0) / turnaroundMs.length / (1000 * 60 * 60)) : null;

  const approved = counts.VERIFIED ?? 0;
  const rejected = counts.VERIFICATION_REJECTED ?? 0;
  const reVerification = counts.RE_VERIFICATION_REQUIRED ?? 0;

  return {
    counts: {
      pending: counts.VERIFICATION_PENDING ?? 0,
      underReview: counts.UNDER_REVIEW ?? 0,
      verified: approved,
      rejected,
      reVerificationRequired: reVerification,
      suspended: suspendedCount, // Profile.status="SUSPENDED" — a Profile-level lifecycle state, not a VerificationStatus value
    },
    approvalRate: safeRate(approved, approved + rejected),
    reVerificationRate: safeRate(reVerification, total),
    avgTurnaroundHours,
    pendingCount: (counts.VERIFICATION_PENDING ?? 0) + (counts.UNDER_REVIEW ?? 0),
  };
}
