import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import type { RestrictionType } from "@prisma/client";

// Independent, scoped, optionally time-boxed restrictions (spec §18) — NOT a
// replacement for the existing blunt Profile.status=SUSPENDED lifecycle
// (src/lib/verification/status.ts's suspendProfile()), which stays the
// full-suspension path. endDate is evaluated lazily here at check time — no
// cron sweep, matching this codebase's existing lazy-expiry convention for
// OTPs/verification documents.
export async function getActiveRestrictions(profileId: string): Promise<RestrictionType[]> {
  const now = new Date();
  const rows = await prisma.profileRestriction.findMany({
    where: {
      profileId,
      active: true,
      OR: [{ endDate: null }, { endDate: { gt: now } }],
    },
    select: { restrictionType: true },
  });
  return rows.map((r) => r.restrictionType);
}

export async function hasActiveRestriction(profileId: string, type: RestrictionType): Promise<boolean> {
  const active = await getActiveRestrictions(profileId);
  return active.includes(type);
}

export async function applyRestriction(params: {
  profileId: string;
  restrictionType: RestrictionType;
  reason: string;
  appliedById: string;
  endDate?: Date | null;
  caseId?: string | null;
}) {
  const restriction = await prisma.profileRestriction.create({
    data: {
      profileId: params.profileId,
      restrictionType: params.restrictionType,
      reason: params.reason,
      appliedById: params.appliedById,
      endDate: params.endDate ?? null,
      caseId: params.caseId ?? null,
    },
  });
  await writeAudit({
    action: "PROFILE_RESTRICTION_APPLIED",
    adminId: params.appliedById,
    targetProfileId: params.profileId,
    meta: { restrictionId: restriction.id, restrictionType: params.restrictionType, reason: params.reason, caseId: params.caseId },
  });
  return restriction;
}

export async function liftRestriction(restrictionId: string, liftedById: string) {
  const restriction = await prisma.profileRestriction.update({
    where: { id: restrictionId },
    data: { active: false, liftedById, liftedAt: new Date() },
  });
  await writeAudit({
    action: "PROFILE_RESTRICTION_LIFTED",
    adminId: liftedById,
    targetProfileId: restriction.profileId,
    meta: { restrictionId, restrictionType: restriction.restrictionType },
  });
  return restriction;
}
