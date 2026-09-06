import { ApiError } from "@/lib/route-guard";
import type { AdminRole } from "@/lib/permissions";

// Row-level gate mirroring src/lib/verification-access.ts — closes a
// confirmed gap where SecurityFlag.assignedToId existed but nothing
// enforced it: SUPER_ADMIN and ADMIN may act on any flag; STAFF only ones
// assigned to them.
export function assertSecurityFlagAccess(admin: { id: string; role: AdminRole }, flag: { assignedToId: string | null }): void {
  if (admin.role === "STAFF" && flag.assignedToId !== admin.id) {
    throw new ApiError(403, "This security flag is not assigned to you.");
  }
}
