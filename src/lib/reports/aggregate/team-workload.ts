import { prisma } from "@/lib/prisma";
import { subDays } from "date-fns";

// Spec §9 — Team Workload Dashboard, open to ADMIN+SUPER_ADMIN (gated by
// "staff:view", distinct from STEP 10's SUPER_ADMIN-only
// reports:staff-performance:view ranking-adjacent report). Explicitly a
// workload/service-quality view, never a competitive ranking — no scores or
// rankings are computed here, only current open-work counts.
export async function computeTeamWorkload() {
  const staff = await prisma.adminUser.findMany({
    where: { active: true, role: { in: ["STAFF", "VIEWER"] } },
    select: { id: true, name: true, role: true },
  });

  const now = new Date();

  const rows = await Promise.all(
    staff.map(async (admin) => {
      const [
        assignedProfiles,
        assignedProposals,
        pendingVerifications,
        pendingFollowUps,
        upcomingMeetings,
        overdueTasks,
        completedTasksLast30Days,
      ] = await Promise.all([
        prisma.adminAssignment.count({ where: { adminId: admin.id, resourceType: "PROFILE", status: { not: "REASSIGNED" } } }),
        prisma.proposal.count({ where: { assignedToId: admin.id } }),
        prisma.profileVerification.count({ where: { assignedToId: admin.id, status: { in: ["VERIFICATION_PENDING", "VERIFICATION_REQUIRED"] } } }),
        prisma.followUp.count({ where: { adminId: admin.id, status: "PENDING" } }),
        prisma.meeting.count({
          where: { proposal: { assignedToId: admin.id }, status: { in: ["REQUESTED", "SCHEDULED", "CONFIRMED"] }, scheduledAt: { gte: now } },
        }),
        prisma.adminTask.count({ where: { assignedToId: admin.id, status: { in: ["PENDING", "IN_PROGRESS"] }, dueAt: { lt: now } } }),
        prisma.adminTask.count({ where: { assignedToId: admin.id, status: "COMPLETED", completedAt: { gte: subDays(now, 30) } } }),
      ]);

      return {
        adminId: admin.id,
        name: admin.name,
        role: admin.role,
        assignedProfiles,
        assignedProposals,
        pendingVerifications,
        pendingFollowUps,
        upcomingMeetings,
        overdueTasks,
        completedTasksLast30Days,
      };
    })
  );

  return { items: rows.sort((a, b) => a.name.localeCompare(b.name)) };
}
