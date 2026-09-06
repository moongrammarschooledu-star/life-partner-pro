import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/route-guard";
import type { AdminRole } from "@/lib/permissions";

// Row-level gate for FollowUp — pre-STEP-11 rows only have a bare `adminId`
// "owner" field with no dedicated assignee or access check at all. This
// prefers the latest AdminAssignment row (which carries priority/due-date/
// reassignment history) and falls back to the legacy `adminId` column for
// follow-ups created before this step existed.
export async function assertFollowUpAccess(
  admin: { id: string; role: AdminRole },
  followUp: { id: string; adminId: string | null }
): Promise<void> {
  if (admin.role !== "STAFF") return;

  const latest = await prisma.adminAssignment.findFirst({
    where: { resourceType: "FOLLOW_UP", resourceId: followUp.id, status: { not: "REASSIGNED" } },
    orderBy: { assignedAt: "desc" },
  });

  const effectiveAssigneeId = latest ? latest.adminId : followUp.adminId;
  if (effectiveAssigneeId !== admin.id) {
    throw new ApiError(403, "This follow-up is not assigned to you.");
  }
}
