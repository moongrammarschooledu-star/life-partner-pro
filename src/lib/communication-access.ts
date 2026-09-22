import { ApiError } from "@/lib/route-guard";
import { hasBroadRecordAccess, type AdminRole } from "@/lib/permissions";

// Row-level gate layered on top of the flat communication:send permission
// (spec §12): a broad-access role (STEP 17) may message any profile/proposal;
// an assignment-scoped role may only send a message tied to a proposal
// assigned to them.
export function assertCommunicationAccess(admin: { id: string; role: AdminRole }, proposal: { assignedToId: string | null } | null): void {
  if (!hasBroadRecordAccess(admin.role) && proposal && proposal.assignedToId !== admin.id) {
    throw new ApiError(403, "This proposal is not assigned to you.");
  }
}
