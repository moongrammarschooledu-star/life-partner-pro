import { ApiError } from "@/lib/route-guard";
import { hasBroadRecordAccess, type AdminRole } from "@/lib/permissions";

// Row-level gate layered on top of the flat proposal:edit permission (spec
// §24): a broad-access role (STEP 17) may edit any proposal; an
// assignment-scoped role (e.g. STAFF_MATCHMAKER) may only edit proposals
// assigned to them.
export function assertProposalAccess(admin: { id: string; role: AdminRole }, proposal: { assignedToId: string | null }): void {
  if (!hasBroadRecordAccess(admin.role) && proposal.assignedToId !== admin.id) {
    throw new ApiError(403, "This proposal is not assigned to you.");
  }
}
