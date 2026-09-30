import { hasBroadRecordAccess, type AdminRole, type Permission } from "@/lib/permissions";
import { ApiError } from "@/lib/route-guard";
import type { CrmRecord } from "@prisma/client";

// STEP 28 §69 — "No Assignment = No Record Access" for a scoped role,
// mirroring src/lib/workflow/access.ts's exact delegation shape (a broad
// role or the record's own assignee, gated by a base permission first).
// This governs the CRM record itself; every LINKED domain (documents,
// communications, membership, risk, cases) still runs its OWN existing
// access check independently — CRM visibility never substitutes for it
// (spec §41 "CRM access does not automatically grant document download
// permission", and the equivalent rule for every other integration).

export interface CrmAccessAdmin {
  id: string;
  role: AdminRole;
  permissions: Permission[];
}

export function canSeeCrmRecord(admin: CrmAccessAdmin, record: Pick<CrmRecord, "assignedStaffId">): boolean {
  if (!admin.permissions.includes("crm:view")) return false;
  if (hasBroadRecordAccess(admin.role)) return true;
  return record.assignedStaffId === admin.id;
}

export function assertCanSeeCrmRecord(admin: CrmAccessAdmin, record: Pick<CrmRecord, "assignedStaffId">): void {
  if (!canSeeCrmRecord(admin, record)) {
    throw new ApiError(403, "You do not have access to this CRM record.");
  }
}

// STEP 28 §24/§70/§71 — which CommunicationVisibility tiers this admin may
// see notes at. manager_view unlocks MANAGER_ONLY; everyone with crm:notes:view
// sees INTERNAL_ONLY/STAFF_SHARED. PUBLIC_TO_USER notes are staff-authored but
// intentionally readable by the applicant too via a SEPARATE applicant-facing
// endpoint (not built in this pass — no applicant-facing CRM note view exists
// yet, so PUBLIC_TO_USER notes are staff-visible only today; never expose
// CrmNote to an applicant/family route without a dedicated, disclosed decision).
export function visibleNoteTiers(admin: CrmAccessAdmin): Array<"PUBLIC_TO_USER" | "INTERNAL_ONLY" | "STAFF_SHARED" | "MANAGER_ONLY"> {
  const tiers: Array<"PUBLIC_TO_USER" | "INTERNAL_ONLY" | "STAFF_SHARED" | "MANAGER_ONLY"> = ["PUBLIC_TO_USER", "INTERNAL_ONLY", "STAFF_SHARED"];
  if (admin.permissions.includes("crm:notes:manager_view") || admin.permissions.includes("sensitive:crm:notes:view")) tiers.push("MANAGER_ONLY");
  return tiers;
}
