import type { FamilyRole } from "@prisma/client";

// Dotted scope-strings (spec §9), each independently grantable/revocable/
// expirable as its own FamilyPermission row — never a monolithic
// role-implies-everything model (STEP 22 plan Decision 4). `sensitive: true`
// permissions route through STEP 19 admin approval when granted (Decision 10)
// — mirrors src/lib/permissions.ts's SENSITIVE_PERMISSIONS convention, but as
// its own, separate catalog (never folded into the admin Permission type).
export interface FamilyPermissionDef {
  label: string;
  sensitive: boolean;
}

export const FAMILY_PERMISSION_CATALOG = {
  "profile.basic.view": { label: "View basic profile information", sensitive: false },
  "profile.education.view": { label: "View education information", sensitive: false },
  "profile.career.view": { label: "View career information", sensitive: false },
  "profile.family.view": { label: "View family background", sensitive: true },
  "profile.lifestyle.view": { label: "View lifestyle information", sensitive: false },
  "profile.requirements.view": { label: "View partner requirements", sensitive: false },
  "profile.edit.suggest": { label: "Suggest profile edits", sensitive: false },
  "proposal.view": { label: "View shared proposals", sensitive: false },
  "proposal.comment": { label: "Comment on proposals", sensitive: false },
  "proposal.respond": { label: "Suggest a proposal response", sensitive: false },
  "meeting.view": { label: "View meetings", sensitive: false },
  "meeting.comment": { label: "Comment on meetings", sensitive: false },
  "meeting.confirm": { label: "Confirm meetings", sensitive: false },
  "meeting.reschedule": { label: "Request a meeting reschedule", sensitive: false },
  "communication.view": { label: "View family communications", sensitive: false },
  "communication.respond": { label: "Respond in family communications", sensitive: false },
} satisfies Record<string, FamilyPermissionDef>;

export type FamilyPermissionKey = keyof typeof FAMILY_PERMISSION_CATALOG;

export function isKnownFamilyPermission(key: string): key is FamilyPermissionKey {
  return Object.prototype.hasOwnProperty.call(FAMILY_PERMISSION_CATALOG, key);
}

// Unknown keys are treated as sensitive (deny-by-default / require approval)
// rather than throwing — a check that can't resolve cleanly must not fall open.
export function isSensitiveFamilyPermission(key: string): boolean {
  if (!isKnownFamilyPermission(key)) return true;
  return FAMILY_PERMISSION_CATALOG[key].sensitive;
}

const VIEWER: FamilyPermissionKey[] = ["profile.basic.view", "profile.education.view", "profile.career.view", "proposal.view", "meeting.view"];
const ADVISOR: FamilyPermissionKey[] = [...VIEWER, "proposal.comment", "profile.edit.suggest", "meeting.comment"];
const COORDINATOR: FamilyPermissionKey[] = [...ADVISOR, "meeting.confirm", "meeting.reschedule", "communication.respond"];

// Only supplies the DEFAULT permission set granted at invitation time — the
// applicant can add/remove individual permissions afterward without
// changing the role label (Decision 4). FAMILY_ADMIN deliberately gets NO
// data-access permissions here: its only capability (manage the family's own
// other members) is checked directly against `role === "FAMILY_ADMIN"` in
// access-control.ts, never via a FamilyPermission row, and it is never given
// any AdminRole-shaped platform permission.
export const FAMILY_ROLE_PERMISSIONS: Record<FamilyRole, FamilyPermissionKey[]> = {
  FAMILY_VIEWER: VIEWER,
  FAMILY_ADVISOR: ADVISOR,
  FAMILY_COORDINATOR: COORDINATOR,
  FAMILY_GUARDIAN: [...COORDINATOR, "proposal.respond", "profile.requirements.view"],
  FAMILY_APPROVER: [...COORDINATOR, "proposal.respond"],
  FAMILY_ADMIN: [],
};
