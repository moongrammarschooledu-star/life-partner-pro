import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http-error";
import { applyRestriction, liftRestriction } from "@/lib/profile-restrictions";
import { sendNotification } from "@/lib/notifications/notification-service";
import type { RestrictionType } from "@prisma/client";

// RiskRestrictionService. Restrictions are always TEMPORARY unless a
// PERMANENT_RESTRICTION approval exists (spec: "temporary restrictions are
// preferred"), always human-applied (ProfileRestriction.appliedById is a
// required admin), and always scoped — a restriction limits one capability,
// it never says anything about the person.

// Spec restriction names → the enforced RestrictionType values.
export const RESTRICTION_LABELS: Record<string, RestrictionType[]> = {
  MATCHING: ["CANNOT_MATCH"],
  PROPOSALS: ["CANNOT_RECEIVE_PROPOSAL", "NO_NEW_PROPOSALS"],
  CONTACT: ["CANNOT_CONTACT_SHARE"],
  MEETINGS: ["CANNOT_SCHEDULE_MEETING"],
  PROFILE_EDITS: ["CANNOT_UPDATE_FIELDS"],
  VERIFICATION_REQUIRED: ["VERIFICATION_REQUIRED"],
  LOGIN: ["LOGIN_RESTRICTED"],
  COMMUNICATION: ["COMMUNICATION_RESTRICTED"],
  PAYMENT: ["PAYMENT_RESTRICTED"],
  FAMILY_ACCESS: ["FAMILY_ACCESS_RESTRICTED"],
  FAMILY_INVITATIONS: ["NO_FAMILY_INVITATIONS"],
  FULL_ACCOUNT: ["FULL_ACCOUNT_RESTRICTED"],
};

export const RISK_RESTRICTION_TYPES: RestrictionType[] = [...new Set(Object.values(RESTRICTION_LABELS).flat())];

export const MAX_TEMPORARY_RESTRICTION_DAYS = 365;

export function resolveRestrictionTypes(input: string[]): RestrictionType[] {
  const out = new Set<RestrictionType>();
  for (const raw of input) {
    const label = RESTRICTION_LABELS[raw];
    if (label) label.forEach((t) => out.add(t));
    else if (RISK_RESTRICTION_TYPES.includes(raw as RestrictionType)) out.add(raw as RestrictionType);
    else throw new HttpError(422, `Unknown restriction "${raw}".`);
  }
  if (out.size === 0) throw new HttpError(422, "At least one restriction type is required.");
  return [...out];
}

// Pure validation, shared by the service and unit tests.
export function validateRestrictionWindow(params: { endDate?: Date | null; isPermanent: boolean; now?: Date }): void {
  const now = params.now ?? new Date();
  if (params.isPermanent) return; // the PERMANENT_RESTRICTION approval is checked by the caller
  if (!params.endDate) throw new HttpError(422, "A restriction needs an end date unless a permanent restriction is approved.");
  if (params.endDate.getTime() <= now.getTime()) throw new HttpError(422, "The restriction end date must be in the future.");
  if (params.endDate.getTime() - now.getTime() > MAX_TEMPORARY_RESTRICTION_DAYS * 86_400_000) {
    throw new HttpError(422, `A temporary restriction cannot exceed ${MAX_TEMPORARY_RESTRICTION_DAYS} days; request a permanent restriction approval instead.`);
  }
}

export async function applyRiskRestrictions(params: {
  profileId: string;
  types: RestrictionType[];
  reason: string;
  actorId: string;
  riskCaseId: string;
  endDate?: Date | null;
  isPermanent?: boolean;
  approvalId?: string | null;
}) {
  const isPermanent = params.isPermanent === true;
  if (isPermanent && !params.approvalId) throw new HttpError(403, "A permanent restriction requires an approved PERMANENT_RESTRICTION request.");
  validateRestrictionWindow({ endDate: params.endDate, isPermanent });

  const created = [];
  for (const restrictionType of params.types) {
    // Idempotent: re-applying the same active restriction for the same case is a no-op.
    const existing = await prisma.profileRestriction.findFirst({
      where: { profileId: params.profileId, restrictionType, riskCaseId: params.riskCaseId, active: true },
      select: { id: true },
    });
    if (existing) continue;
    created.push(
      await applyRestriction({
        profileId: params.profileId,
        restrictionType,
        reason: params.reason,
        appliedById: params.actorId,
        endDate: isPermanent ? null : (params.endDate ?? null),
        source: "risk_case",
        riskCaseId: params.riskCaseId,
        approvalId: params.approvalId ?? null,
        isPermanent,
      })
    );
  }
  await writeAudit({
    action: "RISK_RESTRICTION_APPLIED",
    adminId: params.actorId,
    targetProfileId: params.profileId,
    meta: { riskCaseId: params.riskCaseId, types: params.types, permanent: isPermanent, endDate: params.endDate?.toISOString() ?? null },
  });
  // Neutral notice only: never says why, never names a signal or a level.
  await sendNotification({ profileId: params.profileId, type: "SECURITY_NOTICE", data: {} });
  return created;
}

export async function liftRiskRestrictionsForCase(riskCaseId: string, actorId: string): Promise<number> {
  const active = await prisma.profileRestriction.findMany({ where: { riskCaseId, active: true }, select: { id: true } });
  for (const r of active) await liftRestriction(r.id, actorId);
  return active.length;
}

export async function listActiveRiskRestrictions(profileId: string) {
  const now = new Date();
  return prisma.profileRestriction.findMany({
    where: { profileId, active: true, source: "risk_case", OR: [{ endDate: null }, { endDate: { gt: now } }] },
    orderBy: { createdAt: "desc" },
  });
}
