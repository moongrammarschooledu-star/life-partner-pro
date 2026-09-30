import { prisma } from "@/lib/prisma";
import { subDays } from "date-fns";
import { ACTIVE_TASK_STATUSES } from "@/lib/workflow/status";
import type { LeadStatus } from "@prisma/client";

// STEP 28 §33 — a lead hasn't reached a terminal outcome yet, so it still
// needs staff follow-up (mirrors ACTIVE_TASK_STATUSES's "still open" intent).
const OPEN_LEAD_STATUSES: LeadStatus[] = [
  "NEW",
  "CONTACTED",
  "RESPONDED",
  "QUALIFICATION_PENDING",
  "QUALIFIED",
  "DUPLICATE_REVIEW_REQUIRED",
  "REGISTRATION_STARTED",
  "REGISTERED",
];

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
        assignedCrmRecords,
        pendingLeadFollowUps,
      ] = await Promise.all([
        prisma.adminAssignment.count({ where: { adminId: admin.id, resourceType: "PROFILE", status: { not: "REASSIGNED" } } }),
        prisma.proposal.count({ where: { assignedToId: admin.id } }),
        prisma.profileVerification.count({ where: { assignedToId: admin.id, status: { in: ["VERIFICATION_PENDING", "VERIFICATION_REQUIRED"] } } }),
        prisma.followUp.count({ where: { adminId: admin.id, status: "PENDING" } }),
        prisma.meeting.count({
          where: { proposal: { assignedToId: admin.id }, status: { in: ["REQUESTED", "SCHEDULED", "CONFIRMED"] }, scheduledAt: { gte: now } },
        }),
        prisma.adminTask.count({ where: { assignedToId: admin.id, status: { in: ACTIVE_TASK_STATUSES }, dueAt: { lt: now } } }),
        prisma.adminTask.count({ where: { assignedToId: admin.id, status: "COMPLETED", completedAt: { gte: subDays(now, 30) } } }),
        prisma.crmRecord.count({ where: { assignedStaffId: admin.id } }),
        prisma.lead.count({ where: { assignedStaffId: admin.id, status: { in: OPEN_LEAD_STATUSES } } }),
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
        assignedCrmRecords,
        pendingLeadFollowUps,
      };
    })
  );

  return { items: rows.sort((a, b) => a.name.localeCompare(b.name)) };
}
