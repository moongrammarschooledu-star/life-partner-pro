import { prisma } from "@/lib/prisma";
import type { ReportFilters } from "@/lib/reports/types";

// Spec §18 — Super-Admin-only, operational/workload visibility, never a
// competitive ranking. "Average response time" is measured via FollowUp
// completion (createdAt -> completedAt) — the only clean timestamp pair
// available for admin-attributable turnaround in the current schema.
// Per-proposal admin response time is NOT computed here (documented as a
// deferred metric — no equivalent timestamp pair exists on Proposal).
export async function computeStaffPerformance(filters: ReportFilters) {
  const { from, to } = filters.dateRange;
  const admins = await prisma.adminUser.findMany({ where: { active: true }, select: { id: true, name: true, role: true } });

  const rows = await Promise.all(
    admins.map(async (admin) => {
      const [profilesReviewed, verificationsCompleted, proposalsCreated, followUpsCompletedRows, meetingsManaged, finalizedProposals] = await Promise.all([
        prisma.auditLog.count({ where: { adminId: admin.id, action: { in: ["PROFILE_VIEWED", "PROFILE_EDITED"] }, createdAt: { gte: from, lte: to } } }),
        prisma.profileVerification.count({ where: { lastReviewedById: admin.id, lastReviewedAt: { gte: from, lte: to } } }),
        prisma.proposal.count({ where: { createdById: admin.id, createdAt: { gte: from, lte: to } } }),
        prisma.followUp.findMany({
          where: { adminId: admin.id, status: "COMPLETED", completedAt: { gte: from, lte: to, not: null } },
          select: { createdAt: true, completedAt: true },
        }),
        prisma.meeting.count({ where: { createdById: admin.id, createdAt: { gte: from, lte: to } } }),
        prisma.proposal.count({ where: { finalizedById: admin.id, finalizedAt: { gte: from, lte: to } } }),
      ]);

      const responseTimesHours = followUpsCompletedRows.map((f) => (f.completedAt!.getTime() - f.createdAt.getTime()) / (1000 * 60 * 60));
      const avgResponseTimeHours = responseTimesHours.length > 0 ? Math.round(responseTimesHours.reduce((a, b) => a + b, 0) / responseTimesHours.length) : null;

      return {
        adminId: admin.id,
        name: admin.name,
        role: admin.role,
        profilesReviewed,
        verificationsCompleted,
        proposalsCreated,
        followUpsCompleted: followUpsCompletedRows.length,
        meetingsManaged,
        finalizedProposals,
        avgResponseTimeHours,
      };
    })
  );

  return { items: rows.sort((a, b) => a.name.localeCompare(b.name)) };
}
