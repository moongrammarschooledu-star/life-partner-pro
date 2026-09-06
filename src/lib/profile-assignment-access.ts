import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/route-guard";
import type { AdminRole } from "@/lib/permissions";

// Row-level gate for general Profile assignment (spec §7) — Profile has no
// assignedToId column, so this resolves the latest non-REASSIGNED
// AdminAssignment row instead, mirroring src/lib/verification-access.ts's
// shape. Only meaningful for STAFF; SUPER_ADMIN/ADMIN are unaffected. A
// profile with no assignment row at all is treated as unassigned — STAFF
// may not act on it until it's explicitly assigned.
export async function assertProfileAssignmentAccess(admin: { id: string; role: AdminRole }, profileId: string): Promise<void> {
  if (admin.role !== "STAFF") return;

  const latest = await prisma.adminAssignment.findFirst({
    where: { resourceType: "PROFILE", resourceId: profileId, status: { not: "REASSIGNED" } },
    orderBy: { assignedAt: "desc" },
  });

  if (!latest || latest.adminId !== admin.id) {
    throw new ApiError(403, "This profile is not assigned to you.");
  }
}
