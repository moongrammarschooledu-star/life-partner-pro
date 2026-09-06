import { prisma } from "@/lib/prisma";
import { subDays, subHours } from "date-fns";

export type AlertSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface SecurityAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  description: string;
  occurredAt: Date;
}

// Spec §33 — computed fresh on every page load, not persisted or pushed (no
// background job queue exists anywhere in this codebase — same scope call
// STEP 10 made for its own reports). Each alert is derived from data
// already captured for other purposes (login history, exports, audit log).
export async function computeSecurityAlerts(): Promise<SecurityAlert[]> {
  const now = new Date();
  const alerts: SecurityAlert[] = [];

  const lockouts = await prisma.adminLoginHistory.findMany({
    where: { event: "LOCKED", createdAt: { gte: subDays(now, 7) } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  for (const lock of lockouts) {
    alerts.push({
      id: `lockout-${lock.id}`,
      severity: "HIGH",
      title: "Account locked after repeated failed logins",
      description: `${lock.email} was locked out${lock.ipAddress ? ` from ${lock.ipAddress}` : ""}.`,
      occurredAt: lock.createdAt,
    });
  }

  const failureGroups = await prisma.adminLoginHistory.groupBy({
    by: ["email"],
    where: { event: "FAILURE", createdAt: { gte: subHours(now, 24) } },
    _count: { email: true },
    having: { email: { _count: { gte: 3 } } },
  });
  for (const g of failureGroups) {
    alerts.push({
      id: `failures-${g.email}`,
      severity: "MEDIUM",
      title: "Repeated failed login attempts",
      description: `${g._count.email} failed login attempts for ${g.email} in the last 24 hours.`,
      occurredAt: now,
    });
  }

  const largeExports = await prisma.reportExecution.findMany({
    where: { exportType: { not: null }, recordCount: { gte: 100 }, createdAt: { gte: subDays(now, 7) } },
    include: { createdBy: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  for (const exp of largeExports) {
    alerts.push({
      id: `export-${exp.id}`,
      severity: "MEDIUM",
      title: "Large data export",
      description: `${exp.createdBy.name} exported ${exp.recordCount} records (${exp.exportType}).`,
      occurredAt: exp.createdAt,
    });
  }

  const sensitiveActions = await prisma.auditLog.findMany({
    where: {
      action: { in: ["ADMIN_USER_ROLE_CHANGED", "ADMIN_USER_CREATED", "CUSTOM_ROLE_PERMISSIONS_CHANGED", "TWO_FACTOR_ENABLED", "TWO_FACTOR_DISABLED", "SECURITY_SETTINGS_CHANGED"] },
      createdAt: { gte: subDays(now, 7) },
    },
    include: { admin: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  const ACTION_LABEL: Record<string, string> = {
    ADMIN_USER_ROLE_CHANGED: "changed an admin's role",
    ADMIN_USER_CREATED: "created a new admin account",
    CUSTOM_ROLE_PERMISSIONS_CHANGED: "changed a custom role's permissions",
    TWO_FACTOR_ENABLED: "enabled 2FA for an admin",
    TWO_FACTOR_DISABLED: "disabled 2FA for an admin",
    SECURITY_SETTINGS_CHANGED: "changed critical security settings",
  };
  for (const a of sensitiveActions) {
    alerts.push({
      id: `audit-${a.id}`,
      severity: a.action === "SECURITY_SETTINGS_CHANGED" || a.action === "TWO_FACTOR_DISABLED" ? "HIGH" : "LOW",
      title: "Permission or security change",
      description: `${a.admin?.name ?? "An admin"} ${ACTION_LABEL[a.action] ?? "made a security-relevant change"}.`,
      occurredAt: a.createdAt,
    });
  }

  return alerts.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
}
