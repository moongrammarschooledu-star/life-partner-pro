import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { nextCaseNumber } from "@/lib/case-code";
import { computeSlaDueDates } from "@/lib/case-sla";
import { getSystemControl } from "@/lib/ops/system-control";
import { checkDatabase } from "@/lib/ops/health";
import { validateConfig, hasCritical } from "@/lib/config/validate";
import { readCounter } from "@/lib/observability/metrics";
import { redactString } from "@/lib/observability/redact";
import { logger } from "@/lib/observability/logger";
import { evaluateAlertRules, RULE_CATEGORIES, type MetricsSnapshot, type AlertCandidate } from "@/lib/ops/alert-rules";
import { incidentCategoryFor, incidentPriorityFor } from "@/lib/ops/incident-mapping";
import type { Alert, AlertSeverity, AlertStatus } from "@prisma/client";

const CLOSED: AlertStatus[] = ["RESOLVED", "CLOSED"];

export interface RaiseAlertParams {
  category: string;
  severity: AlertSeverity;
  source: string;
  service: string;
  title: string;
  detail?: string;
  dedupKey: string;
}

// Deduplicated while open: a repeat of the same condition increments the
// occurrence count instead of creating a new alert. CRITICAL alerts open a
// Step 12 incident automatically (spec §39).
export async function raiseAlert(params: RaiseAlertParams): Promise<Alert> {
  const existing = await prisma.alert.findFirst({ where: { dedupKey: params.dedupKey, status: { notIn: CLOSED } } });
  if (existing) {
    return prisma.alert.update({
      where: { id: existing.id },
      data: {
        occurrences: { increment: 1 },
        lastSeenAt: new Date(),
        detail: params.detail ? redactString(params.detail, 500) : existing.detail,
        severity: params.severity === "CRITICAL" ? "CRITICAL" : existing.severity,
      },
    });
  }

  const alert = await prisma.alert.create({
    data: {
      alertCode: await nextSequenceCode("ALT"),
      category: params.category,
      severity: params.severity,
      source: params.source,
      service: params.service,
      title: params.title,
      detail: params.detail ? redactString(params.detail, 500) : null,
      dedupKey: params.dedupKey,
      events: { create: { toStatus: "NEW", note: "Alert raised" } },
    },
  });
  logger.warn("alert_raised", { alertCode: alert.alertCode, category: alert.category, severity: alert.severity });
  void sendAlertWebhook(alert);
  if (alert.severity === "CRITICAL") await openIncidentForAlert(alert.id, null).catch(() => undefined);
  return alert;
}

export async function changeAlertStatus(params: { alertId: string; toStatus: AlertStatus; actorId: string | null; note?: string; assignedToId?: string | null }): Promise<Alert> {
  const alert = await prisma.alert.findUniqueOrThrow({ where: { id: params.alertId } });
  const updated = await prisma.alert.update({
    where: { id: alert.id },
    data: {
      status: params.toStatus,
      ...(params.assignedToId !== undefined ? { assignedToId: params.assignedToId } : {}),
      ...(params.toStatus === "RESOLVED" ? { resolvedAt: new Date(), resolution: params.note ? redactString(params.note, 500) : alert.resolution } : {}),
      events: { create: { actorId: params.actorId, fromStatus: alert.status, toStatus: params.toStatus, note: params.note ? redactString(params.note, 500) : null } },
    },
  });
  await writeAudit({ action: "ALERT_STATUS_CHANGED", adminId: params.actorId, meta: { alertCode: alert.alertCode, from: alert.status, to: params.toStatus } });
  return updated;
}

// Escalates an alert into a Step 12 Case (CaseType.SYSTEM_INCIDENT, numbered
// LPP-INC-######). Idempotent: an alert only ever gets one incident.
export async function openIncidentForAlert(alertId: string, actorId: string | null): Promise<{ caseId: string; caseNumber: string }> {
  const alert = await prisma.alert.findUniqueOrThrow({ where: { id: alertId } });
  if (alert.incidentCaseId) {
    const existing = await prisma.case.findUniqueOrThrow({ where: { id: alert.incidentCaseId }, select: { id: true, caseNumber: true } });
    return { caseId: existing.id, caseNumber: existing.caseNumber };
  }
  const priority = incidentPriorityFor(alert.severity);
  const { firstResponseDueAt, resolutionDueAt } = await computeSlaDueDates(priority);
  const created = await prisma.case.create({
    data: {
      caseNumber: await nextCaseNumber("SYSTEM_INCIDENT"),
      type: "SYSTEM_INCIDENT",
      category: incidentCategoryFor(alert.category),
      subject: `[${alert.alertCode}] ${alert.title}`,
      description: `${alert.title}\n\nService: ${alert.service}\nSource: ${alert.source}\n${alert.detail ? `Detail: ${alert.detail}\n` : ""}First seen: ${alert.firstSeenAt.toISOString()}`,
      priority,
      createdById: actorId,
      firstResponseDueAt,
      resolutionDueAt,
    },
  });
  await prisma.alert.update({ where: { id: alert.id }, data: { incidentCaseId: created.id, events: { create: { actorId, note: `Incident ${created.caseNumber} opened` } } } });
  await writeAudit({ action: "CASE_CREATED", adminId: actorId, meta: { caseId: created.id, caseNumber: created.caseNumber, type: "SYSTEM_INCIDENT", alertCode: alert.alertCode } });
  return { caseId: created.id, caseNumber: created.caseNumber };
}

// Optional outbound notification (spec §38). Only a fixed, admin-set URL from
// the environment is ever called (no user-supplied URL => no SSRF surface),
// https only, no redirects, short timeout, redacted text payload.
async function sendAlertWebhook(alert: Alert): Promise<void> {
  const url = process.env.ALERT_WEBHOOK_URL?.trim();
  if (!url || !url.startsWith("https://")) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(3000),
      body: JSON.stringify({ text: `[${alert.severity}] ${alert.alertCode}: ${redactString(alert.title, 200)} (${alert.service}, ${process.env.APP_ENV ?? process.env.VERCEL_ENV ?? "dev"})` }),
    });
  } catch {
    logger.warn("alert_webhook_failed", { alertCode: alert.alertCode });
  }
}

export async function gatherMetrics(): Promise<MetricsSnapshot> {
  const db = await checkDatabase();
  const empty: MetricsSnapshot = {
    dbOk: db.status === "ok", dbLatencyMs: db.latencyMs, serverErrorsLastHour: 0, storageErrorsLastHour: 0, permissionViolationsLastHour: 0,
    failedAdminLoginsLastHour: 0, failedPaymentsLast24h: 0, failedWebhooksLast24h: 0, reconciliationMismatches: 0, queueBacklog: 0, deadLetterJobs: 0,
    cronConsecutiveFailures: 0, backupsEnabled: true, lastSuccessfulBackupAgeHours: null, lastBackupFailed: false, lastRestoreTestStatus: null,
    lastRestoreTestAgeDays: null, dbSizeMb: null, fileStorageMb: null, configCritical: hasCritical(validateConfig(process.env).issues),
  };
  if (!db.status || db.status !== "ok") return empty;

  const control = await getSystemControl();
  const hourAgo = new Date(Date.now() - 3_600_000);
  const dayAgo = new Date(Date.now() - 24 * 3_600_000);

  const [serverErrors, storageErrors, violations, failedLogins, failedPayments, failedWebhooks, latestRecon, backlog, dead, cron, lastGood, lastBackup, lastRestore, dbSize, fileBytes] = await Promise.all([
    readCounter("errors:server", 1), readCounter("errors:storage", 1), readCounter("security:violations", 1),
    prisma.adminLoginHistory.count({ where: { event: "FAILURE", createdAt: { gte: hourAgo } } }),
    prisma.payment.count({ where: { status: "FAILED", createdAt: { gte: dayAgo } } }),
    prisma.paymentWebhookEvent.count({ where: { status: "FAILED", receivedAt: { gte: dayAgo } } }),
    prisma.reconciliationRun.findFirst({ orderBy: { startedAt: "desc" }, select: { id: true } }),
    prisma.backgroundJob.count({ where: { status: { in: ["PENDING", "RETRYING"] }, runAfter: { lte: hourAgo } } }),
    prisma.backgroundJob.count({ where: { status: "DEAD_LETTER", resolved: false } }),
    prisma.cronTask.findUnique({ where: { name: "daily-tick" } }),
    prisma.backupRun.findFirst({ where: { type: "DATABASE", status: "COMPLETED", prunedAt: null }, orderBy: { startedAt: "desc" }, select: { startedAt: true } }),
    prisma.backupRun.findFirst({ where: { type: "DATABASE" }, orderBy: { startedAt: "desc" }, select: { status: true } }),
    prisma.restoreTest.findFirst({ orderBy: { startedAt: "desc" }, select: { status: true, startedAt: true } }),
    prisma.$queryRaw<Array<{ bytes: bigint }>>`SELECT pg_database_size(current_database()) AS bytes`.catch(() => [{ bytes: BigInt(0) }]),
    prisma.backupFileCopy.aggregate({ _sum: { sizeBytes: true } }).catch(() => ({ _sum: { sizeBytes: 0 } })),
  ]);

  const mismatches = latestRecon ? await prisma.reconciliationItem.count({ where: { runId: latestRecon.id, status: { not: "MATCHED" } } }) : 0;

  return {
    ...empty,
    serverErrorsLastHour: serverErrors,
    storageErrorsLastHour: storageErrors,
    permissionViolationsLastHour: violations,
    failedAdminLoginsLastHour: failedLogins,
    failedPaymentsLast24h: failedPayments,
    failedWebhooksLast24h: failedWebhooks,
    reconciliationMismatches: mismatches,
    queueBacklog: backlog,
    deadLetterJobs: dead,
    cronConsecutiveFailures: cron?.consecutiveFailures ?? 0,
    backupsEnabled: control.backupsEnabled,
    lastSuccessfulBackupAgeHours: lastGood ? (Date.now() - lastGood.startedAt.getTime()) / 3_600_000 : null,
    lastBackupFailed: lastBackup?.status === "FAILED",
    lastRestoreTestStatus: lastRestore?.status ?? null,
    lastRestoreTestAgeDays: lastRestore ? (Date.now() - lastRestore.startedAt.getTime()) / 86_400_000 : null,
    dbSizeMb: Number(dbSize[0]?.bytes ?? 0) / 1_048_576,
    fileStorageMb: (fileBytes._sum.sizeBytes ?? 0) / 1_048_576,
  };
}

// Cron/job entry point: evaluate every rule, raise/refresh alerts for the
// conditions that hold, and auto-resolve owned alerts whose condition cleared.
export async function evaluateAndSyncAlerts(): Promise<{ raised: number; resolved: number }> {
  const [metrics, control] = await Promise.all([gatherMetrics(), getSystemControl()]);
  const candidates: AlertCandidate[] = evaluateAlertRules(metrics, control);

  for (const c of candidates) {
    await raiseAlert({ ...c, source: "monitor" });
  }

  const active = new Set(candidates.map((c) => c.dedupKey));
  const stale = await prisma.alert.findMany({ where: { status: { notIn: CLOSED }, category: { in: [...RULE_CATEGORIES] }, dedupKey: { notIn: [...active] } } });
  for (const alert of stale) {
    await changeAlertStatus({ alertId: alert.id, toStatus: "RESOLVED", actorId: null, note: "Condition cleared automatically" });
  }
  return { raised: candidates.length, resolved: stale.length };
}
