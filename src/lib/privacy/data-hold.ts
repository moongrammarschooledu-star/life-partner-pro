import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { notifyAdmins } from "@/lib/notifications/notification-service";

// Legal/administrative hold (spec §18) — mirrors src/lib/profile-restrictions.ts's
// lazy-expiry precedent (no cron sweep of its own; checked at read time by
// whatever consults it — here, the retention job). Either profile-scoped or
// targeted at a specific record type+id.
export async function hasActiveHold(params: { profileId?: string; recordType?: string; recordId?: string }): Promise<boolean> {
  const hold = await prisma.dataHold.findFirst({
    where: {
      active: true,
      ...(params.profileId ? { profileId: params.profileId } : {}),
      ...(params.recordType && params.recordId ? { recordType: params.recordType, recordId: params.recordId } : {}),
    },
  });
  return !!hold;
}

export async function placeHold(params: {
  profileId?: string;
  recordType?: string;
  recordId?: string;
  reason: string;
  placedById: string;
}) {
  const hold = await prisma.dataHold.create({
    data: {
      profileId: params.profileId ?? null,
      recordType: params.recordType ?? null,
      recordId: params.recordId ?? null,
      reason: params.reason,
      placedById: params.placedById,
    },
  });
  await writeAudit({
    action: "DATA_HOLD_CREATED",
    adminId: params.placedById,
    targetProfileId: params.profileId ?? null,
    meta: { holdId: hold.id, recordType: params.recordType, recordId: params.recordId, reason: params.reason },
  });

  // STEP 23 Add-on — a real, rare, deliberate admin action (never a
  // background/automatic trigger), so a plain notifyAdmins call carries no
  // flooding risk, unlike the event-driven compliance notifications wired
  // into transfer.ts/rules.ts which need a dedup key.
  await notifyAdmins({
    type: "COMPLIANCE_LEGAL_HOLD_ACTIVE",
    data: { relatedProfileId: params.profileId, templateVars: { holdId: hold.id } },
    roles: ["COMPLIANCE_MANAGER"],
  });

  return hold;
}

export async function liftHold(holdId: string, liftedById: string) {
  const hold = await prisma.dataHold.update({
    where: { id: holdId },
    data: { active: false, liftedById, liftedAt: new Date() },
  });
  await writeAudit({
    action: "DATA_HOLD_RELEASED",
    adminId: liftedById,
    targetProfileId: hold.profileId,
    meta: { holdId },
  });
  return hold;
}
