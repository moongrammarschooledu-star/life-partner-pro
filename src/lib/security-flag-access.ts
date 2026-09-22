import { ApiError } from "@/lib/route-guard";
import { hasBroadRecordAccess, type AdminRole } from "@/lib/permissions";

// Row-level gate mirroring src/lib/verification-access.ts — closes a
// confirmed gap where SecurityFlag.assignedToId existed but nothing enforced
// it: a broad-access role (STEP 17) may act on any flag; an
// assignment-scoped role only ones assigned to them.
export function assertSecurityFlagAccess(admin: { id: string; role: AdminRole }, flag: { assignedToId: string | null }): void {
  if (!hasBroadRecordAccess(admin.role) && flag.assignedToId !== admin.id) {
    throw new ApiError(403, "This security flag is not assigned to you.");
  }
}
