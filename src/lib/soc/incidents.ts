import type { Prisma, SocIncident, SocIncidentCategory, SocIncidentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { redactString } from "@/lib/observability/redact";
import { socAudit } from "@/lib/soc/audit";
import { loadViewer } from "@/lib/analytics/viewers";
import { adminsWithPermission, notifyAdmins } from "@/lib/soc/recipients";
import { severityAtLeast, type SocSeverity, type SocViewer } from "@/lib/soc/types";

// STEP 32 — incident response (LPP-INC-######, the same numbering space the ops incidents already use).
//   DETECTED → TRIAGED → INVESTIGATING → CONTAINMENT → REMEDIATION → RECOVERY → POST_INCIDENT_REVIEW → CLOSED
// An incident records an owner, severity, evidence POINTERS (never copies of data), a timeline of every step, containment actions (see
// containment.ts), a communication plan, the root cause and the lessons learned. Closing needs the review fields — an incident cannot be
// closed by simply clicking "close".

export const INCIDENT_FLOW: SocIncidentStatus[] = ["DETECTED", "TRIAGED", "INVESTIGATING", "CONTAINMENT", "REMEDIATION", "RECOVERY", "POST_INCIDENT_REVIEW", "CLOSED"];
export const INCIDENT_CATEGORIES: SocIncidentCategory[] = ["ACCOUNT_COMPROMISE", "AUTHENTICATION_ATTACK", "AUTHORIZATION_FAILURE", "DATA_EXPOSURE", "PRIVACY_INCIDENT", "MALICIOUS_ATTACHMENT", "API_ATTACK", "WEBHOOK_COMPROMISE", "PAYMENT_SECURITY", "AI_SECURITY", "DOCUMENT_ACCESS", "BACKUP_RECOVERY_FAILURE", "THIRD_PARTY_PROVIDER"];
export const EVIDENCE_TYPES = ["SecurityEvent", "SocAlert", "AuditLog", "BackupRun", "WebhookEvent", "AiRequest", "RiskCase", "Case", "AdminSession", "Other"] as const;

const idx = (s: SocIncidentStatus): number => INCIDENT_FLOW.indexOf(s);

// Pure: one step forward; or INVESTIGATING → REMEDIATION when nothing needs containing (a note is then required by the caller); or back to
// INVESTIGATING from the middle stages when new facts reopen the investigation. CLOSED is final.
export function canMove(from: SocIncidentStatus, to: SocIncidentStatus): boolean {
  if (from === "CLOSED") return false;
  if (idx(to) === idx(from) + 1) return true;
  if (from === "INVESTIGATING" && to === "REMEDIATION") return true;
  if (to === "INVESTIGATING" && ["CONTAINMENT", "REMEDIATION", "RECOVERY"].includes(from)) return true;
  return false;
}

export interface IncidentFacts {
  ownerId: string | null;
  rootCause: string | null;
  lessonsLearned: string | null;
  communicationPlan: string | null;
  severity: SocSeverity;
  pendingContainment: number;
}

// Pure: what must be true before moving INTO `to`. Returns an error message, or null when allowed.
export function moveBlocker(to: SocIncidentStatus, f: IncidentFacts, note?: string): string | null {
  const len = (s: string | null) => (s ?? "").trim().length;
  if (to === "TRIAGED" && !f.ownerId) return "Give the incident an owner before triage is complete.";
  if (to === "REMEDIATION" && (!note || note.trim().length < 10)) return "Say what was done (or why no containment was needed) before moving to remediation.";
  if (to === "POST_INCIDENT_REVIEW" && len(f.rootCause) < 20) return "Record the root cause (at least 20 characters) before the post-incident review.";
  if (to === "CLOSED") {
    if (len(f.rootCause) < 20) return "The root cause must be recorded before the incident is closed.";
    if (len(f.lessonsLearned) < 20) return "Lessons learned must be recorded (at least 20 characters) before the incident is closed.";
    if (severityAtLeast(f.severity, "HIGH") && len(f.communicationPlan) < 10) return "A HIGH or CRITICAL incident needs its communication plan recorded before it is closed.";
    if (f.pendingContainment > 0) return "A containment request is still waiting for a decision.";
  }
  return null;
}

async function nextIncidentCode(): Promise<string> {
  const c = await prisma.caseCodeCounter.upsert({ where: { prefix: "INC" }, update: { lastSeq: { increment: 1 } }, create: { prefix: "INC", lastSeq: 1 } });
  return `LPP-INC-${String(c.lastSeq).padStart(6, "0")}`;
}

const text = (s: string | undefined | null, n: number): string => redactString((s ?? "").trim(), n);

export interface NewIncident { title: string; category: SocIncidentCategory; severity: SocSeverity; summary: string; ownerId?: string | null; alertIds?: string[] }

export async function createIncident(actor: SocViewer, input: NewIncident): Promise<SocIncident> {
  const title = text(input.title, 160);
  const summary = text(input.summary, 1500);
  if (title.length < 5) throw new HttpError(422, "Give the incident a title (at least 5 characters).");
  if (summary.length < 10) throw new HttpError(422, "Describe what was seen (at least 10 characters).");
  if (!INCIDENT_CATEGORIES.includes(input.category)) throw new HttpError(422, "Unknown incident category.");
  if (!["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(input.severity)) throw new HttpError(422, "Unknown severity.");
  if (input.ownerId) await assertCanOwn(input.ownerId);
  const alertIds = [...new Set(input.alertIds ?? [])].slice(0, 20);
  const alerts = alertIds.length ? await prisma.socAlert.findMany({ where: { id: { in: alertIds } } }) : [];
  if (alerts.length !== alertIds.length) throw new HttpError(422, "One of the linked alerts does not exist.");

  const incident = await prisma.socIncident.create({
    data: {
      incidentCode: await nextIncidentCode(), title, category: input.category, severity: input.severity, summary, ownerId: input.ownerId ?? null, createdById: actor.id,
      alertIds: alertIds as Prisma.InputJsonValue, evidenceRefs: alerts.map((a) => ({ type: "SocAlert", id: a.id, note: a.alertCode })) as Prisma.InputJsonValue,
      events: { create: { kind: "CREATED", actorId: actor.id, toStatus: "DETECTED", note: alerts.length ? `Opened from ${alerts.length} alert(s)` : "Opened by hand" } },
    },
  });
  for (const a of alerts) {
    await prisma.socAlert.update({ where: { id: a.id }, data: { incidentId: incident.id } });
    await prisma.socAlertEvent.create({ data: { alertId: a.id, kind: "NOTE", actorId: actor.id, note: `Linked to incident ${incident.incidentCode}` } });
  }
  await socAudit({ action: "SOC_INCIDENT_CREATED", actorId: actor.id, resource: "incident", resourceId: incident.id, after: { code: incident.incidentCode, category: input.category, severity: input.severity } });
  if (severityAtLeast(input.severity, "HIGH")) await notifyAdmins(await adminsWithPermission("soc:containment:approve"), "SOC_INCIDENT");
  return incident;
}

async function assertCanOwn(adminId: string): Promise<void> {
  const v = await loadViewer(adminId);
  if (!v || !v.active || !v.permissions.includes("soc:incidents:manage")) throw new HttpError(422, "That person cannot own security incidents.");
}

async function load(id: string): Promise<SocIncident> {
  const i = await prisma.socIncident.findUnique({ where: { id } });
  if (!i) throw new HttpError(404, "Incident not found.");
  return i;
}

export async function moveIncident(actor: SocViewer, id: string, to: SocIncidentStatus, note?: string): Promise<SocIncident> {
  const incident = await load(id);
  if (!canMove(incident.status, to)) throw new HttpError(409, `An incident that is ${incident.status.toLowerCase().replace(/_/g, " ")} cannot move to ${to.toLowerCase().replace(/_/g, " ")}.`);
  const pending = await prisma.socContainmentAction.count({ where: { incidentId: id, status: "REQUESTED" } });
  const blocker = moveBlocker(to, { ownerId: incident.ownerId, rootCause: incident.rootCause, lessonsLearned: incident.lessonsLearned, communicationPlan: incident.communicationPlan, severity: incident.severity, pendingContainment: pending }, note);
  if (blocker) throw new HttpError(422, blocker);
  const updated = await prisma.socIncident.update({ where: { id }, data: { status: to, ...(to === "CLOSED" ? { closedAt: new Date() } : {}) } });
  await prisma.socIncidentEvent.create({ data: { incidentId: id, kind: "STATUS", actorId: actor.id, fromStatus: incident.status, toStatus: to, note: note ? text(note, 500) : null } });
  await socAudit({ action: "SOC_INCIDENT_UPDATED", actorId: actor.id, resource: "incident", resourceId: id, before: { status: incident.status }, after: { status: to } });
  return updated;
}

export async function setOwner(actor: SocViewer, id: string, ownerId: string | null): Promise<SocIncident> {
  const incident = await load(id);
  if (incident.status === "CLOSED") throw new HttpError(409, "A closed incident cannot change owner.");
  if (ownerId) await assertCanOwn(ownerId);
  const updated = await prisma.socIncident.update({ where: { id }, data: { ownerId } });
  await prisma.socIncidentEvent.create({ data: { incidentId: id, kind: "OWNER", actorId: actor.id, note: ownerId ? "Owner assigned" : "Owner removed" } });
  await socAudit({ action: "SOC_INCIDENT_UPDATED", actorId: actor.id, resource: "incident", resourceId: id, before: { ownerId: incident.ownerId }, after: { ownerId } });
  return updated;
}

export type ReviewField = "rootCause" | "lessonsLearned" | "communicationPlan";
const FIELD_KIND: Record<ReviewField, string> = { rootCause: "REVIEW", lessonsLearned: "REVIEW", communicationPlan: "COMMUNICATION" };

export async function recordIncidentField(actor: SocViewer, id: string, field: ReviewField, value: string): Promise<SocIncident> {
  if (!(field in FIELD_KIND)) throw new HttpError(422, "Unknown field.");
  const incident = await load(id);
  if (incident.status === "CLOSED") throw new HttpError(409, "A closed incident cannot be edited.");
  const v = text(value, 2000);
  if (v.length < 10) throw new HttpError(422, "Write at least 10 characters.");
  const updated = await prisma.socIncident.update({ where: { id }, data: { [field]: v } });
  await prisma.socIncidentEvent.create({ data: { incidentId: id, kind: FIELD_KIND[field], actorId: actor.id, note: `${field === "rootCause" ? "Root cause" : field === "lessonsLearned" ? "Lessons learned" : "Communication plan"} recorded` } });
  await socAudit({ action: "SOC_INCIDENT_UPDATED", actorId: actor.id, resource: "incident", resourceId: id, after: { field } });
  return updated;
}

export async function addIncidentNote(actor: SocViewer, id: string, note: string): Promise<void> {
  await load(id);
  const n = text(note, 800);
  if (n.length < 3) throw new HttpError(422, "The note is empty.");
  await prisma.socIncidentEvent.create({ data: { incidentId: id, kind: "NOTE", actorId: actor.id, note: n } });
}

const EVIDENCE_ID = /^[\w.:-]{3,64}$/;

export async function addEvidence(actor: SocViewer, id: string, ref: { type: string; id: string; note?: string }): Promise<SocIncident> {
  const incident = await load(id);
  if (incident.status === "CLOSED") throw new HttpError(409, "A closed incident cannot be edited.");
  if (!(EVIDENCE_TYPES as readonly string[]).includes(ref.type)) throw new HttpError(422, "Unknown evidence type.");
  if (!EVIDENCE_ID.test(ref.id)) throw new HttpError(422, "The evidence reference is not valid. Use an identifier, not content.");
  const current = (Array.isArray(incident.evidenceRefs) ? incident.evidenceRefs : []) as Array<{ type: string; id: string; note?: string }>;
  if (current.length >= 100) throw new HttpError(422, "This incident already holds 100 evidence references.");
  if (current.some((e) => e.type === ref.type && e.id === ref.id)) return incident;
  const next = [...current, { type: ref.type, id: ref.id, ...(ref.note ? { note: text(ref.note, 200) } : {}) }];
  const updated = await prisma.socIncident.update({ where: { id }, data: { evidenceRefs: next as Prisma.InputJsonValue } });
  await prisma.socIncidentEvent.create({ data: { incidentId: id, kind: "EVIDENCE", actorId: actor.id, note: `Added ${ref.type} reference` } });
  return updated;
}

export async function listIncidents(filter: { status?: SocIncidentStatus | "OPEN"; take?: number } = {}) {
  const where: Prisma.SocIncidentWhereInput = filter.status === "OPEN" ? { status: { not: "CLOSED" } } : filter.status ? { status: filter.status } : {};
  return prisma.socIncident.findMany({ where, orderBy: { createdAt: "desc" }, take: Math.min(filter.take ?? 100, 300) });
}

export async function getIncident(id: string) {
  const i = await prisma.socIncident.findUnique({ where: { id }, include: { events: { orderBy: { createdAt: "asc" }, take: 500 }, containment: { orderBy: { createdAt: "asc" }, take: 100 } } });
  if (!i) throw new HttpError(404, "Incident not found.");
  return i;
}
