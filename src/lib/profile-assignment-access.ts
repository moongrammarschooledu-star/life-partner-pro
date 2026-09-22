import { ApiError } from "@/lib/route-guard";
import { getCurrentAssigneeId } from "@/lib/admin-assignment";
import { hasBroadRecordAccess, type AdminRole } from "@/lib/permissions";

// Row-level gate for general Profile assignment (spec §7/§19 — "No
// Assignment = No Record Access") — Profile has no assignedToId column, so
// this resolves the latest non-REASSIGNED, non-expired AdminAssignment row
// instead (see getCurrentAssigneeId, STEP 17 §20). Only meaningful for
// assignment-scoped roles; broad-access roles (STEP 17) are unaffected. A
// profile with no (unexpired) assignment row at all is treated as
// unassigned — an assignment-scoped role may not act on it until it's
// explicitly (re-)assigned.
export async function assertProfileAssignmentAccess(admin: { id: string; role: AdminRole }, profileId: string): Promise<void> {
  if (hasBroadRecordAccess(admin.role)) return;

  const assigneeId = await getCurrentAssigneeId("PROFILE", profileId);
  if (assigneeId !== admin.id) {
    throw new ApiError(403, "This profile is not assigned to you.");
  }
}
