import type { Prisma, SocContainmentAction } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { writeAudit } from "@/lib/audit";
import { applyTechnicalControl } from "@/lib/risk/technical-controls";
import { SWITCH_FIELD, invalidateSystemControl, type EmergencySwitch } from "@/lib/ops/system-control";
import { redactString } from "@/lib/observability/redact";
import { socAudit } from "@/lib/soc/audit";
import { adminsWithPermission, notifyAdmins } from "@/lib/soc/recipients";
import type { SocViewer } from "@/lib/soc/types";
import type { SessionAdmin } from "@/lib/route-guard";

// STEP 32 — containment. A containment action is a TECHNICAL, time-boxed control against an active attack; it is never a decision about a
// person (the existing technical-controls wording and limits apply). Two classes:
//   LOW   — narrow and short (one session, a short throttle, a short network block): the requester's permission is enough and it runs now;
//   HIGH  — broad or long (all of an administrator's sessions, a long block, an emergency kill switch): it waits for a DIFFERENT person who
//           holds soc:containment:approve. Nobody can approve their own request, and nobody can be the target of their own containment.

export type ContainmentType = "REVOKE_SESSION" | "REVOKE_ADMIN_SESSIONS" | "THROTTLE_SUBJECT" | "BLOCK_NETWORK_HASH" | "EMERGENCY_SWITCH";
export const CONTAINMENT_TYPES: ContainmentType[] = ["REVOKE_SESSION", "REVOKE_ADMIN_SESSIONS", "THROTTLE_SUBJECT", "BLOCK_NETWORK_HASH", "EMERGENCY_SWITCH"];

const LOW_THROTTLE_MAX_MINUTES = 120;
const LOW_BLOCK_MAX_MINUTES = 60;
const MAX_MINUTES = 24 * 60;
const REF = /^[\w.:-]{3,80}$/;
const SWITCHES = Object.keys(SWITCH_FIELD) as EmergencySwitch[];

export interface ContainmentParams {
  sessionId?: string;
  adminId?: string;
  subjectType?: "PROFILE" | "ADMIN" | "SUBJECT_KEY";
  subjectRef?: string;
  ipHash?: string;
  minutes?: number;
  switch?: EmergencySwitch;
}

// Pure: validates the parameters for a type and says how impactful the action is. Throws HttpError(422) on bad input.
export function classify(type: ContainmentType, p: ContainmentParams): { impact: "LOW" | "HIGH"; params: ContainmentParams } {
  const need = (v: unknown, name: string): string => {
    if (typeof v !== "string" || !REF.test(v)) throw new HttpError(422, `${name} is missing or not valid.`);
    return v;
  };
  const mins = (v: unknown): number => {
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > MAX_MINUTES) throw new HttpError(422, `Minutes must be a whole number from 1 to ${MAX_MINUTES}.`);
    return v;
  };
  switch (type) {
    case "REVOKE_SESSION":
      return { impact: "LOW", params: { sessionId: need(p.sessionId, "Session") } };
    case "REVOKE_ADMIN_SESSIONS":
      return { impact: "HIGH", params: { adminId: need(p.adminId, "Administrator") } };
    case "THROTTLE_SUBJECT": {
      if (!p.subjectType || !["PROFILE", "ADMIN", "SUBJECT_KEY"].includes(p.subjectType)) throw new HttpError(422, "Subject type is not valid.");
      const minutes = mins(p.minutes);
      return { impact: minutes <= LOW_THROTTLE_MAX_MINUTES ? "LOW" : "HIGH", params: { subjectType: p.subjectType, subjectRef: need(p.subjectRef, "Subject"), minutes } };
    }
    case "BLOCK_NETWORK_HASH": {
      const minutes = mins(p.minutes);
      return { impact: minutes <= LOW_BLOCK_MAX_MINUTES ? "LOW" : "HIGH", params: { ipHash: need(p.ipHash, "Network"), minutes } };
    }
    case "EMERGENCY_SWITCH":
      if (!p.switch || !SWITCHES.includes(p.switch)) throw new HttpError(422, "Unknown emergency switch.");
      return { impact: "HIGH", params: { switch: p.switch } };
    default:
      throw new HttpError(422, "Unknown containment action.");
  }
}

const OPEN_FOR_CONTAINMENT = ["INVESTIGATING", "CONTAINMENT", "REMEDIATION"];

export async function requestContainment(actor: SocViewer, incidentId: string, type: ContainmentType, rawParams: ContainmentParams, reason: string): Promise<SocContainmentAction> {
  if (!actor.permissions.includes("soc:containment:request")) throw new HttpError(403, "You cannot request containment actions.");
  if (!CONTAINMENT_TYPES.includes(type)) throw new HttpError(422, "Unknown containment action.");
  if (reason.trim().length < 10) throw new HttpError(422, "Say why this action is needed (at least 10 characters).");
  const incident = await prisma.socIncident.findUnique({ where: { id: incidentId } });
  if (!incident) throw new HttpError(404, "Incident not found.");
  if (!OPEN_FOR_CONTAINMENT.includes(incident.status)) throw new HttpError(409, "Containment can be requested while the incident is being investigated, contained or remediated.");
  const { impact, params } = classify(type, rawParams);
  if ((type === "REVOKE_ADMIN_SESSIONS" && params.adminId === actor.id) || (type === "THROTTLE_SUBJECT" && params.subjectType === "ADMIN" && params.subjectRef === actor.id)) {
    throw new HttpError(403, "You cannot contain your own account.");
  }
  const row = await prisma.socContainmentAction.create({ data: { incidentId, actionType: type, impact, params: params as Prisma.InputJsonValue, reason: redactString(reason.trim(), 400), requestedById: actor.id } });
  await prisma.socIncidentEvent.create({ data: { incidentId, kind: "CONTAINMENT", actorId: actor.id, note: `Requested ${type} (${impact} impact)` } });
  await socAudit({ action: "SOC_CONTAINMENT_REQUESTED", actorId: actor.id, resource: "containment", resourceId: row.id, after: { incident: incident.incidentCode, type, impact }, reason });

  if (impact === "LOW") return execute(row, actor.id);
  await notifyAdmins((await adminsWithPermission("soc:containment:approve")).filter((id) => id !== actor.id), "SOC_INCIDENT");
  return row;
}

export async function decideContainment(actor: SocViewer, actionId: string, decision: "APPROVE" | "REJECT", note: string): Promise<SocContainmentAction> {
  if (!actor.permissions.includes("soc:containment:approve")) throw new HttpError(403, "You cannot approve containment actions.");
  if (note.trim().length < 5) throw new HttpError(422, "A short note is required.");
  const row = await prisma.socContainmentAction.findUnique({ where: { id: actionId } });
  if (!row) throw new HttpError(404, "Containment request not found.");
  if (row.status !== "REQUESTED") throw new HttpError(409, "This request has already been decided.");
  if (row.requestedById === actor.id) throw new HttpError(403, "You cannot decide your own request.");
  const p = row.params as ContainmentParams;
  if (decision === "APPROVE" && ((row.actionType === "REVOKE_ADMIN_SESSIONS" && p.adminId === actor.id) || (row.actionType === "THROTTLE_SUBJECT" && p.subjectType === "ADMIN" && p.subjectRef === actor.id))) {
    throw new HttpError(403, "You cannot approve an action that targets your own account.");
  }
  const now = new Date();
  const decided = await prisma.socContainmentAction.update({ where: { id: actionId }, data: { status: decision === "APPROVE" ? "APPROVED" : "REJECTED", approvedById: actor.id, decidedAt: now, decisionNote: redactString(note.trim(), 300) } });
  await prisma.socIncidentEvent.create({ data: { incidentId: row.incidentId, kind: "CONTAINMENT", actorId: actor.id, note: `${decision === "APPROVE" ? "Approved" : "Rejected"} ${row.actionType}` } });
  await socAudit({ action: "SOC_CONTAINMENT_DECIDED", actorId: actor.id, resource: "containment", resourceId: actionId, after: { decision, type: row.actionType }, reason: note });
  return decision === "APPROVE" ? execute(decided, actor.id) : decided;
}

async function execute(row: SocContainmentAction, executorId: string): Promise<SocContainmentAction> {
  const p = row.params as ContainmentParams;
  let result = "";
  let controlId: string | null = null;
  let ok = true;
  try {
    const now = new Date();
    switch (row.actionType as ContainmentType) {
      case "REVOKE_SESSION": {
        const s = await prisma.adminSession.findUnique({ where: { id: p.sessionId } });
        if (!s) throw new Error("Session not found.");
        if (s.adminId === row.requestedById || s.adminId === executorId) throw new Error("A session of the person acting cannot be revoked here.");
        const r = await prisma.adminSession.updateMany({ where: { id: s.id, revokedAt: null }, data: { revokedAt: now, revokedById: executorId } });
        result = r.count ? "1 session revoked" : "The session was already ended";
        await writeAudit({ action: "ADMIN_SESSION_REVOKED", adminId: executorId, meta: { sessionId: s.id, targetAdminId: s.adminId, via: "incident-containment" } });
        break;
      }
      case "REVOKE_ADMIN_SESSIONS": {
        if (p.adminId === row.requestedById || p.adminId === executorId) throw new Error("The people acting cannot contain their own account.");
        const r = await prisma.adminSession.updateMany({ where: { adminId: p.adminId, revokedAt: null }, data: { revokedAt: now, revokedById: executorId } });
        result = `${r.count} session(s) revoked`;
        await writeAudit({ action: "ADMIN_SESSION_REVOKED", adminId: executorId, meta: { targetAdminId: p.adminId, count: r.count, via: "incident-containment" } });
        break;
      }
      case "THROTTLE_SUBJECT": {
        const c = await applyTechnicalControl({ controlType: "SUBJECT_THROTTLE", subjectType: p.subjectType!, subjectRef: p.subjectRef!, reason: row.reason, actor: { id: row.requestedById } as unknown as SessionAdmin, durationMinutes: p.minutes });
        controlId = c.id;
        result = `Throttle applied for ${p.minutes} minute(s); it expires by itself`;
        break;
      }
      case "BLOCK_NETWORK_HASH": {
        const c = await applyTechnicalControl({ controlType: "IP_BLOCK", subjectType: "IP_HASH", subjectRef: p.ipHash!, reason: row.reason, actor: { id: row.requestedById } as unknown as SessionAdmin, durationMinutes: p.minutes });
        controlId = c.id;
        result = `Network block applied for ${p.minutes} minute(s); it expires by itself`;
        break;
      }
      case "EMERGENCY_SWITCH": {
        const field = SWITCH_FIELD[p.switch!];
        await prisma.systemControl.upsert({ where: { id: 1 }, update: { [field]: true, updatedById: executorId }, create: { id: 1, [field]: true, updatedById: executorId } });
        invalidateSystemControl();
        await writeAudit({ action: "EMERGENCY_SWITCH_CHANGED", adminId: executorId, meta: { section: "emergency", switch: p.switch, new: true, reason: row.reason, via: "incident-containment" } });
        result = `Emergency switch "${p.switch}" turned on. Turn it off again in System Control when it is safe.`;
        break;
      }
    }
  } catch (error) {
    ok = false;
    result = error instanceof Error ? error.message.slice(0, 200) : "Failed";
  }
  const updated = await prisma.socContainmentAction.update({ where: { id: row.id }, data: { status: ok ? "EXECUTED" : "FAILED", executedAt: new Date(), result, technicalControlId: controlId } });
  await prisma.socIncidentEvent.create({ data: { incidentId: row.incidentId, kind: "CONTAINMENT", actorId: executorId, note: `${row.actionType}: ${ok ? "done" : "failed"} — ${result}`.slice(0, 300) } });
  await socAudit({ action: "SOC_CONTAINMENT_EXECUTED", actorId: executorId, resource: "containment", resourceId: row.id, after: { type: row.actionType, ok } });
  return updated;
}

export async function listContainment(incidentId: string) {
  return prisma.socContainmentAction.findMany({ where: { incidentId }, orderBy: { createdAt: "asc" }, take: 100 });
}
