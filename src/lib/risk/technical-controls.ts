import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http-error";
import type { SessionAdmin } from "@/lib/route-guard";
import type { SecurityIncident, SecurityIncidentControl } from "@prisma/client";

// Emergency TECHNICAL controls against an active attack (spec §33). Kept
// deliberately distinct from adverse account decisions:
//   - always time-boxed (max 24h) and self-expiring;
//   - always applied by a named human with a reason;
//   - phrased as "not a decision about the person" everywhere it is shown;
//   - they throttle/revoke access paths; they never restrict, suspend or reject a profile.

export const MAX_CONTROL_MINUTES = 24 * 60;
export const DEFAULT_CONTROL_MINUTES = 60;

const SUBJECT_TYPES = ["PROFILE", "ADMIN", "IP_HASH", "SUBJECT_KEY"] as const;
export type IncidentSubjectType = (typeof SUBJECT_TYPES)[number];

export async function applyTechnicalControl(params: {
  controlType: SecurityIncidentControl;
  subjectType: IncidentSubjectType;
  subjectRef: string;
  reason: string;
  actor: SessionAdmin;
  durationMinutes?: number;
  riskCaseId?: string | null;
}): Promise<SecurityIncident> {
  if (!SUBJECT_TYPES.includes(params.subjectType)) throw new HttpError(422, "Invalid subject type.");
  if (!params.subjectRef.trim()) throw new HttpError(422, "A subject is required.");
  if (params.reason.trim().length < 5) throw new HttpError(422, "A reason is required.");
  if (params.subjectType === "ADMIN" && params.subjectRef === params.actor.id) throw new HttpError(403, "You cannot apply a control to your own account.");
  const minutes = Math.min(Math.max(Math.trunc(params.durationMinutes ?? DEFAULT_CONTROL_MINUTES), 1), MAX_CONTROL_MINUTES);

  const incident = await prisma.securityIncident.create({
    data: {
      controlType: params.controlType,
      subjectType: params.subjectType,
      subjectRef: params.subjectRef.trim(),
      reason: params.reason.trim().slice(0, 500),
      riskCaseId: params.riskCaseId ?? null,
      createdById: params.actor.id,
      expiresAt: new Date(Date.now() + minutes * 60_000),
    },
  });

  if (params.controlType === "SESSION_REVOCATION" && params.subjectType === "PROFILE") {
    await prisma.profileSession.updateMany({ where: { profileId: params.subjectRef, revokedAt: null }, data: { revokedAt: new Date() } });
  }
  await writeAudit({
    action: "RISK_TECHNICAL_CONTROL_APPLIED",
    adminId: params.actor.id,
    targetProfileId: params.subjectType === "PROFILE" ? params.subjectRef : null,
    meta: { incidentId: incident.id, controlType: params.controlType, subjectType: params.subjectType, minutes, note: "Technical control - not a decision about the person." },
  });
  return incident;
}

export async function isControlActive(controlType: SecurityIncidentControl, subjectType: IncidentSubjectType, subjectRef: string): Promise<boolean> {
  const row = await prisma.securityIncident.findFirst({
    where: { controlType, subjectType, subjectRef, status: "ACTIVE", expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  return !!row;
}

export async function liftTechnicalControl(incidentId: string, actor: SessionAdmin): Promise<SecurityIncident> {
  const incident = await prisma.securityIncident.findUnique({ where: { id: incidentId } });
  if (!incident) throw new HttpError(404, "Incident not found.");
  if (incident.status !== "ACTIVE") throw new HttpError(409, "This control is no longer active.");
  const lifted = await prisma.securityIncident.update({ where: { id: incidentId }, data: { status: "LIFTED", liftedAt: new Date(), liftedById: actor.id } });
  await writeAudit({ action: "RISK_TECHNICAL_CONTROL_APPLIED", adminId: actor.id, meta: { incidentId, lifted: true } });
  return lifted;
}

export async function expireDueControls(): Promise<number> {
  const result = await prisma.securityIncident.updateMany({ where: { status: "ACTIVE", expiresAt: { lte: new Date() } }, data: { status: "EXPIRED" } });
  return result.count;
}
