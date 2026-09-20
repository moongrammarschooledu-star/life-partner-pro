import type { AlertSeverity } from "@prisma/client";

// Pure alert rules (spec §38). Given a metrics snapshot + configured
// thresholds, returns the alert conditions that currently hold. No I/O — the
// alert engine (alerts.ts) gathers the snapshot, persists/dedups/auto-resolves.

export interface MetricsSnapshot {
  dbOk: boolean;
  dbLatencyMs: number | null;
  serverErrorsLastHour: number;
  storageErrorsLastHour: number;
  permissionViolationsLastHour: number;
  failedAdminLoginsLastHour: number;
  failedPaymentsLast24h: number;
  failedWebhooksLast24h: number;
  reconciliationMismatches: number;
  queueBacklog: number;
  deadLetterJobs: number;
  cronConsecutiveFailures: number;
  backupsEnabled: boolean;
  lastSuccessfulBackupAgeHours: number | null;
  lastBackupFailed: boolean;
  lastRestoreTestStatus: string | null;
  lastRestoreTestAgeDays: number | null;
  dbSizeMb: number | null;
  fileStorageMb: number | null;
  configCritical: boolean;
}

export interface AlertThresholds {
  apiLatencyWarnMs: number;
  errorRateWarnPerHour: number;
  failedLoginSpikeThreshold: number;
  paymentFailureSpikeThreshold: number;
  webhookFailureSpikeThreshold: number;
  queueBacklogThreshold: number;
  permissionViolationThreshold: number;
  dbStorageLimitMb: number | null;
  fileStorageLimitMb: number | null;
  capacityWarnPercent: number;
  backupStaleAfterHours: number;
  restoreTestStaleAfterDays: number;
}

export interface AlertCandidate {
  category: string;
  severity: AlertSeverity;
  service: string;
  title: string;
  detail?: string;
  dedupKey: string;
}

// Every category this evaluator owns — used to auto-resolve alerts whose
// condition has cleared (alerts of other categories are never auto-closed).
export const RULE_CATEGORIES = [
  "DATABASE_OUTAGE", "DATABASE_LATENCY", "CONFIG_CRITICAL", "ERROR_RATE", "STORAGE_FAILURE", "PERMISSION_VIOLATIONS",
  "FAILED_LOGIN_SPIKE", "PAYMENT_FAILURE_SPIKE", "WEBHOOK_FAILURE_SPIKE", "RECONCILIATION_MISMATCH", "QUEUE_BACKLOG",
  "DEAD_LETTER_JOBS", "CRON_FAILURES", "BACKUP_FAILURE", "BACKUP_STALE", "RESTORE_TEST_FAILED", "RESTORE_TEST_STALE",
  "DB_CAPACITY", "FILE_CAPACITY",
] as const;

export function evaluateAlertRules(m: MetricsSnapshot, t: AlertThresholds): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  const add = (c: AlertCandidate) => out.push(c);

  if (!m.dbOk) add({ category: "DATABASE_OUTAGE", severity: "CRITICAL", service: "database", title: "Database is unreachable", dedupKey: "DATABASE_OUTAGE" });
  else if (m.dbLatencyMs != null && m.dbLatencyMs > t.apiLatencyWarnMs) add({ category: "DATABASE_LATENCY", severity: "WARNING", service: "database", title: "Database latency is high", detail: `${m.dbLatencyMs} ms (threshold ${t.apiLatencyWarnMs} ms)`, dedupKey: "DATABASE_LATENCY" });

  if (m.configCritical) add({ category: "CONFIG_CRITICAL", severity: "CRITICAL", service: "configuration", title: "Critical configuration problem", detail: "See Production Readiness → Environment for the exact key.", dedupKey: "CONFIG_CRITICAL" });

  if (m.serverErrorsLastHour >= t.errorRateWarnPerHour) add({ category: "ERROR_RATE", severity: m.serverErrorsLastHour >= t.errorRateWarnPerHour * 3 ? "CRITICAL" : "HIGH", service: "application", title: "High server error rate", detail: `${m.serverErrorsLastHour} errors in the last hour (threshold ${t.errorRateWarnPerHour})`, dedupKey: "ERROR_RATE" });
  if (m.storageErrorsLastHour > 0) add({ category: "STORAGE_FAILURE", severity: m.storageErrorsLastHour >= 5 ? "HIGH" : "WARNING", service: "storage", title: "Storage errors detected", detail: `${m.storageErrorsLastHour} in the last hour`, dedupKey: "STORAGE_FAILURE" });
  if (m.permissionViolationsLastHour >= t.permissionViolationThreshold) add({ category: "PERMISSION_VIOLATIONS", severity: "HIGH", service: "security", title: "Spike in denied / unauthenticated admin requests", detail: `${m.permissionViolationsLastHour} in the last hour`, dedupKey: "PERMISSION_VIOLATIONS" });
  if (m.failedAdminLoginsLastHour >= t.failedLoginSpikeThreshold) add({ category: "FAILED_LOGIN_SPIKE", severity: "HIGH", service: "security", title: "Excessive failed admin logins", detail: `${m.failedAdminLoginsLastHour} in the last hour`, dedupKey: "FAILED_LOGIN_SPIKE" });

  if (m.failedPaymentsLast24h >= t.paymentFailureSpikeThreshold) add({ category: "PAYMENT_FAILURE_SPIKE", severity: "HIGH", service: "payments", title: "Payment failure spike", detail: `${m.failedPaymentsLast24h} failed in 24h`, dedupKey: "PAYMENT_FAILURE_SPIKE" });
  if (m.failedWebhooksLast24h >= t.webhookFailureSpikeThreshold) add({ category: "WEBHOOK_FAILURE_SPIKE", severity: "HIGH", service: "webhooks", title: "Webhook failure spike", detail: `${m.failedWebhooksLast24h} failed in 24h`, dedupKey: "WEBHOOK_FAILURE_SPIKE" });
  if (m.reconciliationMismatches > 0) add({ category: "RECONCILIATION_MISMATCH", severity: "HIGH", service: "payments", title: "Payment reconciliation mismatches need review", detail: `${m.reconciliationMismatches} unmatched item(s) in the latest run`, dedupKey: "RECONCILIATION_MISMATCH" });

  if (m.queueBacklog > t.queueBacklogThreshold) add({ category: "QUEUE_BACKLOG", severity: "WARNING", service: "jobs", title: "Background job backlog", detail: `${m.queueBacklog} overdue jobs (threshold ${t.queueBacklogThreshold})`, dedupKey: "QUEUE_BACKLOG" });
  if (m.deadLetterJobs > 0) add({ category: "DEAD_LETTER_JOBS", severity: "WARNING", service: "jobs", title: "Jobs in dead-letter state", detail: `${m.deadLetterJobs} unresolved`, dedupKey: "DEAD_LETTER_JOBS" });
  if (m.cronConsecutiveFailures >= 3) add({ category: "CRON_FAILURES", severity: "HIGH", service: "cron", title: "Scheduled task failing repeatedly", detail: `${m.cronConsecutiveFailures} consecutive failures`, dedupKey: "CRON_FAILURES" });

  if (m.backupsEnabled) {
    if (m.lastBackupFailed) add({ category: "BACKUP_FAILURE", severity: "CRITICAL", service: "backup", title: "Latest backup failed", dedupKey: "BACKUP_FAILURE" });
    if (m.lastSuccessfulBackupAgeHours == null) add({ category: "BACKUP_STALE", severity: "HIGH", service: "backup", title: "No successful backup exists", dedupKey: "BACKUP_STALE" });
    else if (m.lastSuccessfulBackupAgeHours > t.backupStaleAfterHours) add({ category: "BACKUP_STALE", severity: "HIGH", service: "backup", title: "Last successful backup is stale", detail: `${Math.round(m.lastSuccessfulBackupAgeHours)} h old (limit ${t.backupStaleAfterHours} h)`, dedupKey: "BACKUP_STALE" });
  }
  if (m.lastRestoreTestStatus === "FAILED") add({ category: "RESTORE_TEST_FAILED", severity: "CRITICAL", service: "backup", title: "Latest restore verification failed", dedupKey: "RESTORE_TEST_FAILED" });
  if (m.backupsEnabled && (m.lastRestoreTestAgeDays == null || m.lastRestoreTestAgeDays > t.restoreTestStaleAfterDays)) add({ category: "RESTORE_TEST_STALE", severity: "WARNING", service: "backup", title: "Restore verification is overdue", detail: m.lastRestoreTestAgeDays == null ? "No restore test has ever run" : `${Math.round(m.lastRestoreTestAgeDays)} days old (limit ${t.restoreTestStaleAfterDays})`, dedupKey: "RESTORE_TEST_STALE" });

  const pct = (used: number | null, limit: number | null) => (used != null && limit != null && limit > 0 ? (used / limit) * 100 : null);
  const dbPct = pct(m.dbSizeMb, t.dbStorageLimitMb);
  if (dbPct != null && dbPct >= t.capacityWarnPercent) add({ category: "DB_CAPACITY", severity: dbPct >= 95 ? "CRITICAL" : "HIGH", service: "database", title: "Database storage nearing its limit", detail: `${Math.round(dbPct)}% of ${t.dbStorageLimitMb} MB`, dedupKey: "DB_CAPACITY" });
  const filePct = pct(m.fileStorageMb, t.fileStorageLimitMb);
  if (filePct != null && filePct >= t.capacityWarnPercent) add({ category: "FILE_CAPACITY", severity: filePct >= 95 ? "CRITICAL" : "HIGH", service: "storage", title: "File storage nearing its limit", detail: `${Math.round(filePct)}% of ${t.fileStorageLimitMb} MB`, dedupKey: "FILE_CAPACITY" });

  return out;
}
