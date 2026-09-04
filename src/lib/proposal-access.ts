import { ApiError } from "@/lib/route-guard";
import type { AdminRole } from "@/lib/permissions";

// Row-level gate layered on top of the flat proposal:edit permission (spec
// §24): ADMIN/SUPER_ADMIN may edit any proposal; STAFF may only edit
// proposals assigned to them.
export function assertProposalAccess(admin: { id: string; role: AdminRole }, proposal: { assignedToId: string | null }): void {
  if (admin.role === "STAFF" && proposal.assignedToId !== admin.id) {
    throw new ApiError(403, "This proposal is not assigned to you.");
  }
}
