import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { notifyAccountDeactivated, notifyAccountReactivated } from "@/lib/notifications/events";
import type { AccountStatus, ProfileStatus } from "@prisma/client";

// Spec §41 — a unified display-level status label. `accountStatus` and
// `status` are separate, orthogonal source-of-truth fields (see schema
// comment on Profile.accountStatus); this function only MERGES them for
// dashboards — it is not itself a new source of truth, and active
// restrictions are read-only input here (never mutated).
export type EffectiveAccountStatus =
  | "ACTIVE"
  | "PENDING_VERIFICATION"
  | "UNDER_REVIEW"
  | "RESTRICTED"
  | "SUSPENDED"
  | "DEACTIVATED"
  | "DELETION_REQUESTED"
  | "DELETION_PROCESSING"
  | "DELETED"
  | "ARCHIVED";

export function resolveAccountStatus(profile: {
  accountStatus: AccountStatus;
  status: ProfileStatus;
  softDeleted: boolean;
  verified: boolean;
}, hasActiveRestrictions: boolean): EffectiveAccountStatus {
  if (profile.accountStatus === "DELETED") return "DELETED";
  if (profile.accountStatus === "DELETION_PROCESSING") return "DELETION_PROCESSING";
  if (profile.accountStatus === "DELETION_REQUESTED") return "DELETION_REQUESTED";
  if (profile.accountStatus === "DEACTIVATED") return "DEACTIVATED";

  if (profile.softDeleted || profile.status === "ARCHIVED") return "ARCHIVED";
  if (profile.status === "SUSPENDED") return "SUSPENDED";
  if (hasActiveRestrictions) return "RESTRICTED";
  if (profile.status === "UNDER_REVIEW") return "UNDER_REVIEW";
  if (profile.status === "NEW" && !profile.verified) return "PENDING_VERIFICATION";
  return "ACTIVE";
}

// Spec §12 — real enforcement (matching exclusion, proposal blocking,
// notification suppression, contact-sharing block) is wired at the same
// choke points STEP 12 already instrumented for ProfileRestriction; this
// function only flips the field and notifies.
export async function deactivateAccount(profileId: string) {
  await prisma.profile.update({ where: { id: profileId }, data: { accountStatus: "DEACTIVATED" } });
  await writeAudit({ action: "ACCOUNT_DEACTIVATED", targetProfileId: profileId });
  await notifyAccountDeactivated(profileId);
}

// Spec §13 — reactivation explicitly does NOT restore independently-revoked
// ProfileRestriction rows, does not reset consent state, and does not
// re-verify — those are each their own separate, unaffected system.
export async function reactivateAccount(profileId: string) {
  await prisma.profile.update({ where: { id: profileId }, data: { accountStatus: "ACTIVE" } });
  await writeAudit({ action: "ACCOUNT_REACTIVATED", targetProfileId: profileId });
  await notifyAccountReactivated(profileId);
}
