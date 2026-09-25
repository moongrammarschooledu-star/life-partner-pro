import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { createTask } from "@/lib/admin-tasks";
import { isSensitiveFamilyPermission, isKnownFamilyPermission } from "@/lib/family/permissions";
import { HttpError } from "@/lib/http-error";

export class FamilyGrantError extends HttpError {
  constructor(status: number, message: string) {
    super(status, message);
    this.name = "FamilyGrantError";
  }
}

// Single write path for creating/updating a FamilyPermission row — used by
// invitation.ts (default role grants at acceptance) and the applicant-facing
// grant/edit routes (Milestone 6). Non-sensitive permissions activate
// immediately (the applicant's own grant is sufficient); sensitive ones
// (per FAMILY_PERMISSION_CATALOG) are created PENDING_APPROVAL and routed to
// staff via a FAMILY_PERMISSION_REVIEW task — the actual STEP 19
// enforceApprovalGate() call happens in the ADMIN'S OWN approval route
// (enforceApprovalGate requires an admin actor; it cannot be invoked directly
// from an applicant-facing route) — see src/lib/family/permissions.ts's
// Decision 10 comment.
export async function grantFamilyPermission(params: {
  familyMemberId: string;
  permission: string;
  scope?: string | null;
  grantedByProfileId: string;
  expiresAt?: Date | null;
}) {
  if (!isKnownFamilyPermission(params.permission)) {
    throw new FamilyGrantError(400, `Unknown permission: ${params.permission}`);
  }
  const sensitive = isSensitiveFamilyPermission(params.permission);
  // Prisma's compound-unique where-input can't express NULL (SQL NULL isn't
  // self-equal, so a nullable column can't participate in a unique lookup) —
  // "" is the "no specific scope / all shared records" sentinel throughout
  // this module instead of null.
  const scope = params.scope ?? "";

  const row = await prisma.familyPermission.upsert({
    where: { familyMemberId_permission_scope: { familyMemberId: params.familyMemberId, permission: params.permission, scope } },
    update: {
      status: sensitive ? "PENDING_APPROVAL" : "ACTIVE",
      grantedByProfileId: params.grantedByProfileId,
      grantedByAdminId: null,
      grantedAt: new Date(),
      expiresAt: params.expiresAt ?? null,
      revokedAt: null,
    },
    create: {
      familyMemberId: params.familyMemberId,
      permission: params.permission,
      scope,
      status: sensitive ? "PENDING_APPROVAL" : "ACTIVE",
      grantedByProfileId: params.grantedByProfileId,
      expiresAt: params.expiresAt ?? null,
    },
  });

  await writeAudit({
    action: "FAMILY_PERMISSION_GRANTED",
    targetProfileId: params.grantedByProfileId,
    actorFamilyMemberId: null,
    meta: { familyMemberId: params.familyMemberId, permission: params.permission, sensitive, status: row.status },
  });

  if (sensitive) {
    await createTask({ taskType: "FAMILY_PERMISSION_REVIEW", resourceType: "PROFILE", resourceId: params.grantedByProfileId });
  }

  return row;
}

export async function revokeFamilyPermission(familyMemberId: string, permission: string, scope: string | null, revokedByProfileId: string) {
  const result = await prisma.familyPermission.updateMany({
    where: { familyMemberId, permission, scope: scope ?? "", revokedAt: null },
    data: { status: "REVOKED", revokedAt: new Date() },
  });
  if (result.count > 0) {
    await writeAudit({ action: "FAMILY_PERMISSION_REVOKED", targetProfileId: revokedByProfileId, meta: { familyMemberId, permission } });
  }
  return result.count > 0;
}
