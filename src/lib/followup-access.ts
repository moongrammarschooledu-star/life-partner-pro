import { ApiError } from "@/lib/route-guard";
import { getCurrentAssigneeId } from "@/lib/admin-assignment";
import { hasBroadRecordAccess, type AdminRole } from "@/lib/permissions";

// Row-level gate for FollowUp — pre-STEP-11 rows only have a bare `adminId`
// "owner" field with no dedicated assignee or access check at all. This
// prefers the latest AdminAssignment row (which carries priority/due-date/
// expiry/reassignment history — see getCurrentAssigneeId, STEP 17 §20) and
// falls back to the legacy `adminId` column for follow-ups created before
// that step existed.
export async function assertFollowUpAccess(
  admin: { id: string; role: AdminRole },
  followUp: { id: string; adminId: string | null }
): Promise<void> {
  if (hasBroadRecordAccess(admin.role)) return;

  const effectiveAssigneeId = (await getCurrentAssigneeId("FOLLOW_UP", followUp.id)) ?? followUp.adminId;
  if (effectiveAssigneeId !== admin.id) {
    throw new ApiError(403, "This follow-up is not assigned to you.");
  }
}
