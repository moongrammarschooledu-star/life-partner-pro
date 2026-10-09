import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { scrubForAudit } from "@/lib/marketing/audit";
import type { AuditAction } from "@prisma/client";

// STEP 32 — two trails, kept apart on purpose (same split as analytics):
//  - socAudit: an AuditLog row for every CHANGE (alert status, rule version, incident step, containment, configuration, drill, plan). The shared
//    scrubber keeps contact details, tokens and secrets out of `meta`.
//  - logSocAccess: a SocAccessLog row for every READ or denied attempt (who opened which screen). Never any result data.

// Every audit action this module writes, for the screens that list the security-operations change history.
export const SOC_AUDIT_ACTIONS: AuditAction[] = [
  "SOC_ALERT_CREATED", "SOC_ALERT_UPDATED", "SOC_ALERT_ESCALATED", "SOC_RULE_CHANGED", "SOC_RULE_DRY_RUN", "SOC_DETECTION_RUN", "SOC_INCIDENT_CREATED", "SOC_INCIDENT_UPDATED",
  "SOC_CONTAINMENT_REQUESTED", "SOC_CONTAINMENT_DECIDED", "SOC_CONTAINMENT_EXECUTED", "SOC_CONFIG_CHANGED", "SOC_RESTORE_DRILL_RECORDED", "SOC_RESTORE_DRILL_REVIEWED",
  "SOC_DR_PLAN_CHANGED", "SOC_DR_TEST_RECORDED", "SOC_ACCESS_DENIED",
];

export interface SocAuditParams {
  action: AuditAction;
  actorId?: string | null;
  resource: string;
  resourceId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  extra?: Record<string, unknown>;
}

export async function socAudit(p: SocAuditParams): Promise<void> {
  await writeAudit({
    action: p.action,
    adminId: p.actorId ?? null,
    meta: scrubForAudit({ resource: p.resource, resourceId: p.resourceId, before: p.before, after: p.after, reason: p.reason ?? undefined, ...(p.extra ?? {}) }) as Record<string, unknown>,
  });
}

export type SocAccessAction = "VIEW" | "RUN" | "CHANGE" | "DENIED" | "EXPORT";

// Fail-open: losing one access-log row must never break the screen being opened.
export async function logSocAccess(p: { adminId: string; action: SocAccessAction; resource: string; resourceId?: string | null; outcome?: "ALLOWED" | "DENIED" }): Promise<void> {
  try {
    await prisma.socAccessLog.create({
      data: { adminId: p.adminId, action: p.action, resource: p.resource.slice(0, 60), resourceId: p.resourceId?.slice(0, 60) ?? null, outcome: p.outcome ?? (p.action === "DENIED" ? "DENIED" : "ALLOWED") },
    });
  } catch {
    /* fail-open */
  }
}
