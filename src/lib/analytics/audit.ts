import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { scrubForAudit } from "@/lib/marketing/audit";
import type { AuditAction } from "@prisma/client";

// STEP 31 — two trails, deliberately separate:
//  - analyticsAudit: AuditLog rows for CHANGES (metrics, KPIs, dashboards, reports, settings, rebuilds, exports). The shared
//    scrubber keeps contact details, tokens and secrets out of `meta`; analytics never writes data values into it.
//  - logAnalyticsAccess: AnalyticsAccessLog rows for READS (who opened/queried/exported what, allowed or denied). No result data.

export interface AnalyticsAuditParams {
  action: AuditAction;
  actorId?: string | null;
  resource: string;
  resourceId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  extra?: Record<string, unknown>;
}

export async function analyticsAudit(p: AnalyticsAuditParams): Promise<void> {
  await writeAudit({
    action: p.action,
    adminId: p.actorId ?? null,
    meta: scrubForAudit({ resource: p.resource, resourceId: p.resourceId, before: p.before, after: p.after, reason: p.reason ?? undefined, ...(p.extra ?? {}) }) as Record<string, unknown>,
  });
}

export type AccessAction = "VIEW" | "QUERY" | "EXPORT" | "SHARE" | "RUN" | "DENIED";

// Never throws: failing to log an access must not break a dashboard, but a denied or sensitive access also gets an AuditLog row.
export async function logAnalyticsAccess(p: { adminId: string; action: AccessAction; resource: string; resourceId?: string | null; sensitive?: boolean; outcome?: "ALLOWED" | "DENIED"; detail?: Record<string, unknown> }): Promise<void> {
  try {
    await prisma.analyticsAccessLog.create({
      data: {
        adminId: p.adminId, action: p.action, resource: p.resource.slice(0, 60), resourceId: p.resourceId?.slice(0, 60) ?? null,
        sensitive: !!p.sensitive, outcome: p.outcome ?? "ALLOWED", detail: p.detail ? (scrubForAudit(p.detail) as never) : undefined,
      },
    });
    if (p.outcome === "DENIED") await analyticsAudit({ action: "ANALYTICS_ACCESS_DENIED", actorId: p.adminId, resource: p.resource, resourceId: p.resourceId ?? "-" });
    else if (p.sensitive && (p.action === "EXPORT" || p.action === "QUERY" || p.action === "VIEW")) await analyticsAudit({ action: "ANALYTICS_SENSITIVE_ACCESS", actorId: p.adminId, resource: p.resource, resourceId: p.resourceId ?? "-", extra: { access: p.action } });
  } catch (error) {
    console.error("[analytics] access log failed", error instanceof Error ? error.message : "error");
  }
}
