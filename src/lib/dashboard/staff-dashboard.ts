import { prisma } from "@/lib/prisma";
import { subDays } from "date-fns";

// Spec §10 — STAFF sees only their own assigned workload, not the org-wide
// KPI set SUPER_ADMIN/ADMIN get from computeFullDashboard(). Enforced here
// server-side (this function is the only thing the STAFF branch of the
// dashboard route calls), not just hidden client-side.
export async function computeStaffDashboard(adminId: string) {
  const now = new Date();

  const [
    assignedProfiles,
    assignedProposals,
    assignedVerifications,
    pendingFollowUps,
    upcomingMeetings,
    overdueTasks,
    pendingTasks,
    completedTasksLast30Days,
  ] = await Promise.all([
    prisma.adminAssignment.count({ where: { adminId, resourceType: "PROFILE", status: { not: "REASSIGNED" } } }),
    prisma.proposal.count({ where: { assignedToId: adminId } }),
    prisma.profileVerification.count({ where: { assignedToId: adminId, status: { in: ["VERIFICATION_PENDING", "VERIFICATION_REQUIRED"] } } }),
    prisma.followUp.count({ where: { adminId, status: "PENDING" } }),
    prisma.meeting.count({
      where: { proposal: { assignedToId: adminId }, status: { in: ["REQUESTED", "SCHEDULED", "CONFIRMED"] }, scheduledAt: { gte: now } },
    }),
    prisma.adminTask.count({ where: { assignedToId: adminId, status: { in: ["PENDING", "IN_PROGRESS"] }, dueAt: { lt: now } } }),
    prisma.adminTask.count({ where: { assignedToId: adminId, status: "PENDING" } }),
    prisma.adminTask.count({ where: { assignedToId: adminId, status: "COMPLETED", completedAt: { gte: subDays(now, 30) } } }),
  ]);

  return {
    assignedProfiles,
    assignedProposals,
    assignedVerifications,
    pendingFollowUps,
    upcomingMeetings,
    overdueTasks,
    pendingTasks,
    completedTasksLast30Days,
  };
}
