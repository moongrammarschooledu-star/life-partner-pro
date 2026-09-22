import { ApiError } from "@/lib/route-guard";
import { hasBroadRecordAccess, type AdminRole } from "@/lib/permissions";

// Row-level gate layered on top of the flat verification:review/flag:manage
// permissions (mirrors src/lib/proposal-access.ts from STEP 7): a broad-access
// role (STEP 17 — manager tiers and above) may review any profile's
// verification; an assignment-scoped role (e.g. VERIFICATION_STAFF) only ones
// assigned to them.
export function assertVerificationAccess(admin: { id: string; role: AdminRole }, verification: { assignedToId: string | null }): void {
  if (!hasBroadRecordAccess(admin.role) && verification.assignedToId !== admin.id) {
    throw new ApiError(403, "This verification is not assigned to you.");
  }
}
