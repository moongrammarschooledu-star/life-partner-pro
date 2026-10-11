import { prisma } from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { checkDatabase } from "@/lib/ops/health";
import { getSystemControl } from "@/lib/ops/system-control";
import { backupOverview } from "@/lib/soc/backups";
import { drOverview } from "@/lib/soc/disaster-recovery";
import { mfaCoverage } from "@/lib/soc/admin-security";
import { computeReadiness } from "@/lib/soc/readiness";
import { OPEN_STATUSES } from "@/lib/soc/alerts";
import { getSocSettings } from "@/lib/soc/settings";
import { SOC_AUDIT_ACTIONS } from "@/lib/soc/audit";
import type { SocSeverity } from "@/lib/soc/types";

// STEP 32 — the Security Operations overview. Every figure here is a count or a status read from a real table at request time, with the
// table named next to it; nothing is estimated, cached across requests or filled in. Where there is nothing to count the answer is 0 or
// "none yet" — never a placeholder that looks like data.

const SEVERITIES: SocSeverity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
const SIGNALS = [
  ["LOGIN_FAILED", "Failed sign-ins"], ["OTP_FAILED", "Wrong one-time codes"], ["PERMISSION_DENIED", "Refused for missing permission"], ["API_AUTH_FAILURE", "Unauthenticated API requests"],
  ["RATE_LIMIT_EXCEEDED", "Rate limits hit"], ["WEBHOOK_SIGNATURE_FAILURE", "Webhook signature failures"], ["WEBHOOK_REPLAY_ATTEMPT", "Webhook replays"],
  ["DOCUMENT_UNAUTHORIZED_ACCESS", "Unauthorised document requests"], ["BULK_EXPORT", "Data exports"], ["ADMIN_SESSION_ANOMALY", "Admin session anomalies"],
  ["NEW_DEVICE_SESSION", "New-device sign-ins"], ["AI_PROMPT_INJECTION_SUSPECTED", "Prompt-injection patterns in AI input"],
] as const;

export async function socOverview(now: Date = new Date()) {
  const day = new Date(now.getTime() - 24 * 3_600_000);
  const settings = await getSocSettings();
  const [socOn, detOn, escOn] = await Promise.all([isFeatureEnabled("soc.enabled"), isFeatureEnabled("soc.detection.enabled"), isFeatureEnabled("soc.escalation.enabled")]);

  const [openAlerts, alertsBySeverity, unacknowledged, newestAlerts, openIncidents, incidentsBySeverity, newestIncidents, signalCounts, login, webhookRejected, webhookFailed, marketingRejected,
    activeSessions, db, opsAlerts, fileSources, fileMirrored, recentAudit] = await Promise.all([
    prisma.socAlert.count({ where: { status: { in: OPEN_STATUSES } } }),
    Promise.all(SEVERITIES.map(async (s) => [s, await prisma.socAlert.count({ where: { status: { in: OPEN_STATUSES }, severity: s } })] as const)),
    prisma.socAlert.count({ where: { status: { in: ["NEW", "ESCALATED"] }, acknowledgedAt: null } }),
    prisma.socAlert.findMany({ where: { status: { in: OPEN_STATUSES } }, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, alertCode: true, title: true, severity: true, status: true, source: true, createdAt: true } }),
    prisma.socIncident.count({ where: { status: { not: "CLOSED" } } }),
    Promise.all(SEVERITIES.map(async (s) => [s, await prisma.socIncident.count({ where: { status: { not: "CLOSED" }, severity: s } })] as const)),
    prisma.socIncident.findMany({ where: { status: { not: "CLOSED" } }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, incidentCode: true, title: true, severity: true, status: true, category: true, createdAt: true } }),
    prisma.securityEvent.groupBy({ by: ["eventType"], where: { createdAt: { gte: day }, eventType: { in: SIGNALS.map((s) => s[0]) } }, _count: { _all: true } }),
    Promise.all((["SUCCESS", "FAILURE", "LOCKED"] as const).map(async (e) => [e, await prisma.adminLoginHistory.count({ where: { event: e, createdAt: { gte: day } } })] as const)),
    prisma.webhookEvent.count({ where: { status: "REJECTED", createdAt: { gte: day } } }),
    prisma.webhookEvent.count({ where: { status: "FAILED", createdAt: { gte: day } } }),
    prisma.marketingWebhookEvent.count({ where: { status: "REJECTED", receivedAt: { gte: day } } }),
    prisma.adminSession.count({ where: { revokedAt: null, expiresAt: { gt: now } } }),
    checkDatabase(),
    prisma.alert.groupBy({ by: ["severity"], where: { status: { notIn: ["RESOLVED", "CLOSED"] } }, _count: { _all: true } }),
    Promise.all([prisma.profilePhoto.count(), prisma.verificationDocument.count(), prisma.caseEvidence.count()]).then((a) => a.reduce((x, y) => x + y, 0)),
    prisma.backupFileCopy.count(),
    prisma.auditLog.findMany({ where: { action: { in: SOC_AUDIT_ACTIONS } }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, action: true, adminId: true, createdAt: true } }),
  ]);

  const [backups, dr, mfa, control] = await Promise.all([backupOverview(now), drOverview(now), mfaCoverage(), getSystemControl()]);
  const counts = new Map(signalCounts.map((r) => [r.eventType as string, r._count._all]));
  const sev = (rows: ReadonlyArray<readonly [string, number]>, s: string) => rows.find((r) => r[0] === s)?.[1] ?? 0;
  const lastSummary = (settings.lastDetectionSummary ?? null) as { errors?: unknown[] } | null;

  const readiness = computeReadiness({
    now,
    flags: { socEnabled: socOn, detection: detOn, escalation: escOn },
    lastDetectionAt: settings.lastDetectionAt,
    lastDetectionErrors: Array.isArray(lastSummary?.errors) ? lastSummary!.errors!.length : 0,
    backup: { health: backups.health, reasons: backups.reasons },
    restore: { hasProof: dr.restoreProof.hasProof, ageDays: dr.restoreProof.ageDays, staleAfterDays: control.restoreTestStaleAfterDays },
    dr: { hasActivePlan: !!dr.plan, rpo: dr.comparison.rpo, rto: dr.comparison.rto, testOverdue: dr.tests.overdue },
    openCriticalAlerts: sev(alertsBySeverity, "CRITICAL"),
    openHighAlerts: sev(alertsBySeverity, "HIGH"),
    openCriticalIncidents: sev(incidentsBySeverity, "CRITICAL"),
    mfaGaps: mfa.gaps.length,
    privilegedAdmins: mfa.privilegedTotal,
    sessionIdleMinutes: settings.sessionIdleMinutes,
    cspEnforced: process.env.CSP_MODE === "enforce",
    backupCiphertextPublicUrls: true, // backup objects are written with public (unguessable) URLs by the storage service; see BACKUP_AND_RESTORE_GUIDE
  });

  return {
    generatedAt: now.toISOString(),
    readiness,
    alerts: { open: openAlerts, unacknowledged, bySeverity: Object.fromEntries(alertsBySeverity), newest: newestAlerts, source: "SocAlert" },
    incidents: { open: openIncidents, bySeverity: Object.fromEntries(incidentsBySeverity), newest: newestIncidents, source: "SocIncident" },
    criticalAndHigh: { alerts: sev(alertsBySeverity, "CRITICAL") + sev(alertsBySeverity, "HIGH"), incidents: sev(incidentsBySeverity, "CRITICAL") + sev(incidentsBySeverity, "HIGH") },
    signals24h: { items: SIGNALS.map(([key, label]) => ({ key, label, count: counts.get(key) ?? 0 })), source: "SecurityEvent, last 24 hours" },
    adminLogins24h: { ...Object.fromEntries(login.map(([k, v]) => [k.toLowerCase(), v])), source: "AdminLoginHistory, last 24 hours" },
    webhooks24h: { rejected: webhookRejected, failed: webhookFailed, marketingRejected, source: "WebhookEvent and MarketingWebhookEvent, last 24 hours" },
    adminSecurity: { activeSessions, privilegedAdmins: mfa.privilegedTotal, mfaGaps: mfa.gaps.length, enforceMfaPrivileged: mfa.policy.enforceMfaPrivileged, sessionIdleMinutes: settings.sessionIdleMinutes, maxConcurrentSessions: settings.maxConcurrentSessions },
    systemHealth: {
      database: { status: db.status, latencyMs: db.latencyMs },
      fileBackupCoverage: { sources: fileSources, mirrored: fileMirrored },
      infrastructureAlertsOpen: Object.fromEntries(opsAlerts.map((r) => [r.severity, r._count._all])),
      source: "ops health, Alert, BackupFileCopy",
    },
    backups: { health: backups.health, reasons: backups.reasons, lastBackup: backups.latestDatabase, lastVerified: backups.lastVerified, storage: backups.storage },
    restore: { hasProof: dr.restoreProof.hasProof, lastProven: dr.restoreProof.lastProven, lastAttempt: dr.restoreProof.lastAttempt },
    disasterRecovery: { configured: dr.configured, measured: dr.measured, comparison: dr.comparison, planVersion: dr.plan?.version ?? null, testsOverdue: dr.tests.overdue },
    detection: { enabled: socOn && detOn, escalationEnabled: socOn && escOn, lastRunAt: settings.lastDetectionAt, lastSummary: settings.lastDetectionSummary },
    recentAudit,
  };
}
