import type { SocAlertStatus, SocSettings } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { socAudit } from "@/lib/soc/audit";
import { adminsWithPermission, notifyAdmins } from "@/lib/soc/recipients";
import type { SocSeverity } from "@/lib/soc/types";

// STEP 32 — escalation of alerts nobody has acknowledged. Two steps at most, each notifying the next tier by the permission it holds:
//   level 1 (after N minutes)  → people who can APPROVE containment (the senior tier);
//   level 2 (after 2N minutes) → responders and approvers together.
// N depends on the alert's severity and is set in the security configuration (0 = never escalate that severity). INFO and LOW never escalate.

export const MAX_ESCALATION_LEVEL = 2;
const UNACKNOWLEDGED: SocAlertStatus[] = ["NEW", "ESCALATED"];

export function escalationMinutes(severity: SocSeverity, s: Pick<SocSettings, "escalateCriticalMinutes" | "escalateHighMinutes" | "escalateMediumMinutes">): number {
  return severity === "CRITICAL" ? s.escalateCriticalMinutes : severity === "HIGH" ? s.escalateHighMinutes : severity === "MEDIUM" ? s.escalateMediumMinutes : 0;
}

// Pure: the escalation level an unacknowledged alert should be at, or null when it should not move.
export function escalationTarget(a: { severity: SocSeverity; status: SocAlertStatus; createdAt: Date; escalationLevel: number; acknowledgedAt: Date | null }, s: Pick<SocSettings, "escalateCriticalMinutes" | "escalateHighMinutes" | "escalateMediumMinutes">, now: Date): number | null {
  if (!UNACKNOWLEDGED.includes(a.status) || a.acknowledgedAt) return null;
  const minutes = escalationMinutes(a.severity, s);
  if (minutes <= 0) return null;
  const age = (now.getTime() - a.createdAt.getTime()) / 60_000;
  const level = age >= minutes * 2 ? 2 : age >= minutes ? 1 : 0;
  return level > a.escalationLevel && level <= MAX_ESCALATION_LEVEL ? level : null;
}

export interface EscalationResult { examined: number; escalated: number; notified: number }

export async function runEscalation(settings: SocSettings, now: Date = new Date()): Promise<EscalationResult> {
  const result: EscalationResult = { examined: 0, escalated: 0, notified: 0 };
  if (!(await isFeatureEnabled("soc.enabled")) || !(await isFeatureEnabled("soc.escalation.enabled"))) return result;
  const candidates = await prisma.socAlert.findMany({ where: { status: { in: UNACKNOWLEDGED }, acknowledgedAt: null, severity: { in: ["MEDIUM", "HIGH", "CRITICAL"] } }, orderBy: { createdAt: "asc" }, take: 500 });
  for (const a of candidates) {
    result.examined++;
    const level = escalationTarget(a, settings, now);
    if (!level) continue;
    const recipients = level === 1 ? await adminsWithPermission("soc:containment:approve") : [...(await adminsWithPermission("soc:alerts:manage")), ...(await adminsWithPermission("soc:containment:approve"))];
    const sent = await notifyAdmins(recipients, "SOC_ALERT");
    await prisma.socAlert.update({ where: { id: a.id }, data: { escalationLevel: level, escalatedAt: now, status: "ESCALATED" } });
    await prisma.socAlertEvent.create({ data: { alertId: a.id, kind: "ESCALATE", fromStatus: a.status, toStatus: "ESCALATED", note: `Not acknowledged in time; escalated to level ${level}; notified ${sent} person(s)` } });
    await socAudit({ action: "SOC_ALERT_ESCALATED", actorId: null, resource: "alert", resourceId: a.id, after: { level, notified: sent } });
    result.escalated++;
    result.notified += sent;
  }
  return result;
}
