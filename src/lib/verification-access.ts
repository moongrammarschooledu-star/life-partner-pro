import { ApiError } from "@/lib/route-guard";
import type { AdminRole } from "@/lib/permissions";

// Row-level gate layered on top of the flat verification:review/flag:manage
// permissions (mirrors src/lib/proposal-access.ts from STEP 7): SUPER_ADMIN
// and ADMIN may review any profile's verification; STAFF only ones assigned
// to them.
export function assertVerificationAccess(admin: { id: string; role: AdminRole }, verification: { assignedToId: string | null }): void {
  if (admin.role === "STAFF" && verification.assignedToId !== admin.id) {
    throw new ApiError(403, "This verification is not assigned to you.");
  }
}
