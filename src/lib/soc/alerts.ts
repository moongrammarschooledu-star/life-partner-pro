import type { Prisma, SocAlert, SocAlertStatus, SocSettings } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { redactString } from "@/lib/observability/redact";
import { socAudit } from "@/lib/soc/audit";
import { adminsWithPermission, notifyAdmins } from "@/lib/soc/recipients";
import { loadViewer } from "@/lib/analytics/viewers";
import type { Finding, RuleConfig, RuleDefinition, SocSeverity, SocViewer } from "@/lib/soc/types";
import { severityAtLeast, severityRank } from "@/lib/soc/types";

// STEP 32 — security alerts (LPP-SEC-ALERT-######). Lifecycle:
//   NEW → ACKNOWLEDGED → INVESTIGATING → RESOLVED → CLOSED     (+ FALSE_POSITIVE, ESCALATED)
// Resolving or marking a false positive needs a written resolution. Wording is neutral: an alert says what was counted, never who is guilty.

export const OPEN_STATUSES: SocAlertStatus[] = ["NEW", "ACKNOWLEDGED", "INVESTIGATING", "ESCALATED"];
const CLOSED_STATUSES: SocAlertStatus[] = ["RESOLVED", "FALSE_POSITIVE", "CLOSED"];

export const ALERT_TRANSITIONS: Record<SocAlertStatus, SocAlertStatus[]> = {
  NEW: ["ACKNOWLEDGED", "FALSE_POSITIVE", "ESCALATED"],
  ACKNOWLEDGED: ["INVESTIGATING", "FALSE_POSITIVE", "ESCALATED"],
  INVESTIGATING: ["RESOLVED", "FALSE_POSITIVE", "ESCALATED"],
  ESCALATED: ["ACKNOWLEDGED", "INVESTIGATING", "RESOLVED", "FALSE_POSITIVE"],
  RESOLVED: ["CLOSED", "INVESTIGATING"], // reopening is allowed until it is closed
  FALSE_POSITIVE: ["CLOSED"],
  CLOSED: [],
};

export const canTransition = (from: SocAlertStatus, to: SocAlertStatus): boolean => ALERT_TRANSITIONS[from].includes(to);
export const needsResolutionText = (to: SocAlertStatus): boolean => to === "RESOLVED" || to === "FALSE_POSITIVE";
const clean = (s: string, n: number): string => redactString(s.trim(), n);

export type RaiseOutcome = "CREATED" | "REPEATED" | "SUPPRESSED";

// Dedup, in order:
//  1. an alert for the same rule+subject is still open  → no new alert; if there is newer evidence, bump it ("REPEATED");
//  2. the latest alert for it is closed and the new finding covers nothing newer than it already saw → "SUPPRESSED" (already handled);
//  3. it was closed less than the suppression window ago → "SUPPRESSED" (alarm-fatigue guard);
//  4. otherwise a new alert.
export async function recordFinding(def: RuleDefinition, cfg: RuleConfig & { version: number }, f: Finding, settings: Pick<SocSettings, "suppressionWindowMinutes">, now: Date = new Date()): Promise<RaiseOutcome> {
  const dedupKey = `${def.key}:${f.subject}`;
  const open = await prisma.socAlert.findFirst({ where: { dedupKey, status: { in: OPEN_STATUSES } }, orderBy: { createdAt: "desc" } });
  if (open) {
    if (f.windowEnd > open.lastSeenAt.getTime()) {
      await prisma.socAlert.update({
        where: { id: open.id },
        data: { lastSeenAt: new Date(f.windowEnd), occurrences: { increment: 1 }, summary: f.summary, ...(severityRank(cfg.severity) > severityRank(open.severity) ? { severity: cfg.severity } : {}) },
      });
      await prisma.socAlertEvent.create({ data: { alertId: open.id, kind: "REPEAT", note: `Seen again: ${f.summary}`.slice(0, 300) } });
    }
    return "REPEATED";
  }
  const last = await prisma.socAlert.findFirst({ where: { dedupKey, status: { in: CLOSED_STATUSES } }, orderBy: { createdAt: "desc" } });
  if (last) {
    if (f.windowEnd <= last.lastSeenAt.getTime()) return "SUPPRESSED";
    const closedAt = (last.resolvedAt ?? last.updatedAt).getTime();
    if (settings.suppressionWindowMinutes > 0 && now.getTime() - closedAt < settings.suppressionWindowMinutes * 60_000) return "SUPPRESSED";
  }
  const alertCode = await nextSequenceCode("SEC-ALERT");
  const created = await prisma.socAlert.create({
    data: {
      alertCode, ruleKey: def.key, ruleVersion: cfg.version, category: def.category, severity: cfg.severity, title: def.title, summary: f.summary, source: def.source,
      affectedResource: f.resource, evidenceRefs: f.evidence as Prisma.InputJsonValue, dedupKey, firstSeenAt: new Date(f.windowStart), lastSeenAt: new Date(f.windowEnd),
      events: { create: { kind: "CREATED", note: `Raised by rule ${def.key} v${cfg.version}` } },
    },
  });
  await socAudit({ action: "SOC_ALERT_CREATED", actorId: null, resource: "alert", resourceId: created.id, after: { alertCode, rule: def.key, severity: cfg.severity } });
  if (severityAtLeast(cfg.severity, "HIGH")) {
    const n = await notifyAdmins(await adminsWithPermission("soc:alerts:manage"), "SOC_ALERT");
    await prisma.socAlertEvent.create({ data: { alertId: created.id, kind: "NOTIFY", note: `Notified ${n} responder(s)` } });
  }
  return "CREATED";
}

async function loadAlert(id: string): Promise<SocAlert> {
  const a = await prisma.socAlert.findUnique({ where: { id } });
  if (!a) throw new HttpError(404, "Alert not found.");
  return a;
}

export async function changeAlertStatus(actor: SocViewer, id: string, to: SocAlertStatus, note?: string): Promise<SocAlert> {
  const alert = await loadAlert(id);
  if (!canTransition(alert.status, to)) throw new HttpError(409, `An alert that is ${alert.status.toLowerCase().replace("_", " ")} cannot move to ${to.toLowerCase().replace("_", " ")}.`);
  const text = note ? clean(note, 600) : "";
  if (needsResolutionText(to) && text.length < 10) throw new HttpError(422, "Write what was found and what was done (at least 10 characters).");
  const now = new Date();
  const data: Prisma.SocAlertUpdateInput = { status: to };
  if (to === "ACKNOWLEDGED" || (to === "INVESTIGATING" && !alert.acknowledgedAt)) {
    data.acknowledgedAt = now;
    data.acknowledgedById = actor.id;
  }
  if (to === "RESOLVED" || to === "FALSE_POSITIVE") {
    data.resolution = text;
    data.resolvedAt = now;
    data.resolvedById = actor.id;
  }
  if (to === "ESCALATED") {
    data.escalatedAt = now;
    data.escalationLevel = Math.max(alert.escalationLevel, 1);
  }
  const updated = await prisma.socAlert.update({ where: { id }, data });
  await prisma.socAlertEvent.create({ data: { alertId: id, kind: "STATUS", actorId: actor.id, fromStatus: alert.status, toStatus: to, note: text || null } });
  await socAudit({ action: "SOC_ALERT_UPDATED", actorId: actor.id, resource: "alert", resourceId: id, before: { status: alert.status }, after: { status: to } });
  if (to === "ESCALATED") {
    const n = await notifyAdmins(await adminsWithPermission("soc:containment:approve"), "SOC_ALERT");
    await prisma.socAlertEvent.create({ data: { alertId: id, kind: "NOTIFY", note: `Escalated by hand; notified ${n} approver(s)` } });
  }
  return updated;
}

export async function assignAlert(actor: SocViewer, id: string, assigneeId: string | null): Promise<SocAlert> {
  const alert = await loadAlert(id);
  if (CLOSED_STATUSES.includes(alert.status)) throw new HttpError(409, "A closed alert cannot be assigned.");
  if (assigneeId) {
    const who = await loadViewer(assigneeId);
    if (!who || !who.active || !who.permissions.includes("soc:alerts:view")) throw new HttpError(422, "That person cannot work on security alerts.");
  }
  const updated = await prisma.socAlert.update({ where: { id }, data: { assignedToId: assigneeId } });
  await prisma.socAlertEvent.create({ data: { alertId: id, kind: "ASSIGN", actorId: actor.id, note: assigneeId ? "Assigned" : "Unassigned" } });
  await socAudit({ action: "SOC_ALERT_UPDATED", actorId: actor.id, resource: "alert", resourceId: id, before: { assignedToId: alert.assignedToId }, after: { assignedToId: assigneeId } });
  return updated;
}

export async function addAlertNote(actor: SocViewer, id: string, note: string): Promise<void> {
  await loadAlert(id);
  const text = clean(note, 600);
  if (text.length < 3) throw new HttpError(422, "The note is empty.");
  await prisma.socAlertEvent.create({ data: { alertId: id, kind: "NOTE", actorId: actor.id, note: text } });
}

export interface AlertFilter { status?: SocAlertStatus | "OPEN"; severity?: SocSeverity; ruleKey?: string; take?: number }

export async function listAlerts(filter: AlertFilter = {}) {
  const where: Prisma.SocAlertWhereInput = {
    ...(filter.status === "OPEN" ? { status: { in: OPEN_STATUSES } } : filter.status ? { status: filter.status } : {}),
    ...(filter.severity ? { severity: filter.severity } : {}),
    ...(filter.ruleKey ? { ruleKey: filter.ruleKey } : {}),
  };
  return prisma.socAlert.findMany({ where, orderBy: [{ createdAt: "desc" }], take: Math.min(filter.take ?? 100, 300) });
}

export async function getAlert(id: string) {
  const a = await prisma.socAlert.findUnique({ where: { id }, include: { events: { orderBy: { createdAt: "asc" }, take: 300 } } });
  if (!a) throw new HttpError(404, "Alert not found.");
  return a;
}
