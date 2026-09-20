import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { validateConfig, resolveAppEnv } from "@/lib/config/validate";
import { getSystemControl, getPublicState } from "@/lib/ops/system-control";
import { getReadiness, getHealthReport } from "@/lib/ops/health";
import { rateLimitPersistent } from "@/lib/ops/rate-limit-persistent";
import { getSandboxReadinessChecklist, getPaymentSystemHealth } from "@/lib/finance/rollout";
import { captureError } from "@/lib/observability/error-capture";
import { raiseAlert, changeAlertStatus } from "@/lib/ops/alerts";
import { evaluateReadiness, type ReadinessFacts, type EvidenceFact } from "@/lib/ops/gates";
import { randomUUID } from "crypto";

// Gathers LIVE facts + fresh CI evidence and feeds the pure evaluator in
// gates.ts. Nothing here can mark the system READY by itself: it only reports
// what it can actually observe or what CI has proven.

// Evidence that proves something about a specific build is only honoured when
// it was recorded for the commit that is actually deployed.
const SHA_BOUND = new Set(["BUILD", "TYPECHECK", "LINT", "TESTS", "SECURITY_SCAN", "DEPENDENCY_AUDIT", "MIGRATION_VALIDATION", "SMOKE", "SECURITY_SMOKE"]);

export const EVIDENCE_KINDS = ["BUILD", "TYPECHECK", "LINT", "TESTS", "SECURITY_SCAN", "DEPENDENCY_AUDIT", "MIGRATION_VALIDATION", "SMOKE", "SECURITY_SMOKE", "SMOKE_AUTH", "LOAD_TEST"] as const;

async function loadEvidence(currentSha: string | null): Promise<Record<string, EvidenceFact | undefined>> {
  const out: Record<string, EvidenceFact | undefined> = {};
  for (const kind of EVIDENCE_KINDS) {
    const rows = await prisma.ciEvidence.findMany({ where: { kind }, orderBy: { createdAt: "desc" }, take: 20 });
    const row = SHA_BOUND.has(kind) && currentSha ? rows.find((r) => r.commitSha.startsWith(currentSha.slice(0, 7)) || currentSha.startsWith(r.commitSha.slice(0, 7))) : rows[0];
    if (row) out[kind] = { status: row.status === "PASS" ? "PASS" : "FAIL", ageDays: (Date.now() - row.createdAt.getTime()) / 86_400_000 };
  }
  return out;
}

async function probeHeaders(): Promise<ReadinessFacts["headers"]> {
  const base = process.env.APP_URL?.trim() || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
  const none = { probed: false, https: false, hsts: false, nosniff: false, csp: "none" as const, poweredBy: false };
  if (!base) return none;
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/api/health/live`, { signal: AbortSignal.timeout(4000), redirect: "manual", cache: "no-store" });
    const h = res.headers;
    return {
      probed: true,
      https: base.startsWith("https://"),
      hsts: Boolean(h.get("strict-transport-security")),
      nosniff: h.get("x-content-type-options") === "nosniff",
      csp: h.get("content-security-policy") ? "enforce" : h.get("content-security-policy-report-only") ? "report-only" : "none",
      poweredBy: Boolean(h.get("x-powered-by")),
    };
  } catch {
    return none;
  }
}

async function migrationFacts(): Promise<ReadinessFacts["migrations"]> {
  try {
    const rows = await prisma.$queryRaw<Array<{ applied: number; failed: number }>>`
      SELECT COUNT(*) FILTER (WHERE finished_at IS NOT NULL)::int AS applied,
             COUNT(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::int AS failed
      FROM "_prisma_migrations"`;
    return { tracked: true, applied: Number(rows[0]?.applied ?? 0), failed: Number(rows[0]?.failed ?? 0) };
  } catch {
    return { tracked: false, applied: 0, failed: 0 };
  }
}

export async function gatherReadinessFacts(): Promise<ReadinessFacts> {
  const env = process.env;
  const { appEnv, issues } = validateConfig(env);
  const control = await getSystemControl();
  const currentSha = env.VERCEL_GIT_COMMIT_SHA ?? null;

  const probeKey = `readiness-probe:${randomUUID()}`;
  await rateLimitPersistent(probeKey, 5, 60_000);
  const probe = await rateLimitPersistent(probeKey, 5, 60_000);

  const [readiness, health, evidence, headers, migrations, publicState] = await Promise.all([
    getReadiness(), getHealthReport({ detail: false }), loadEvidence(currentSha), probeHeaders(), migrationFacts(), getPublicState().catch(() => null),
  ]);

  const dayAgo = new Date(Date.now() - 24 * 3_600_000);
  const [lastGood, lastVerifiedRun, failedBackups, lastRestore, fileSources, fileMirrored, lastFileRun, worker, alertEval, tick, deadLetter, openCritical, integrity, payment, checklist, latestRecon, killSwitch, bankAccounts, appSettings, legacyPhotos, release, previousHealthy, selfTest, slow] = await Promise.all([
    prisma.backupRun.findFirst({ where: { type: "DATABASE", status: "COMPLETED", prunedAt: null }, orderBy: { startedAt: "desc" } }),
    prisma.backupRun.findFirst({ where: { type: "DATABASE", status: "COMPLETED", prunedAt: null }, orderBy: { startedAt: "desc" }, select: { verificationStatus: true } }),
    prisma.backupRun.count({ where: { status: "FAILED" } }),
    prisma.restoreTest.findFirst({ orderBy: { startedAt: "desc" } }),
    Promise.all([prisma.profilePhoto.count(), prisma.verificationDocument.count(), prisma.caseEvidence.count()]).then((a) => a.reduce((x, y) => x + y, 0)),
    prisma.backupFileCopy.count(),
    prisma.backupRun.findFirst({ where: { type: "FILES" }, orderBy: { startedAt: "desc" }, select: { status: true } }),
    prisma.cronTask.findUnique({ where: { name: "job-worker" } }),
    prisma.cronTask.findUnique({ where: { name: "alert-evaluation" } }),
    prisma.cronTask.findUnique({ where: { name: "daily-tick" } }),
    prisma.backgroundJob.count({ where: { status: "DEAD_LETTER", resolved: false } }),
    prisma.alert.count({ where: { severity: "CRITICAL", status: { notIn: ["RESOLVED", "CLOSED"] } } }),
    prisma.integrityCheckRun.findFirst({ where: { status: { in: ["CLEAN", "FINDINGS"] } }, orderBy: { startedAt: "desc" } }),
    getPaymentSystemHealth(),
    getSandboxReadinessChecklist(),
    prisma.reconciliationRun.findFirst({ where: { completedAt: { not: null } }, orderBy: { startedAt: "desc" }, select: { discrepancyCount: true } }),
    prisma.auditLog.count({ where: { action: "PAYMENT_KILL_SWITCH_USED" } }),
    prisma.bankAccount.count({ where: { active: true } }),
    prisma.appSettings.findUnique({ where: { id: 1 } }),
    prisma.profilePhoto.count({ where: { OR: [{ ivBase64: null }, { authTagBase64: null }] } }),
    currentSha ? prisma.release.findUnique({ where: { commitSha_environment: { commitSha: currentSha, environment: appEnv } } }) : Promise.resolve(null),
    prisma.release.count({ where: { environment: appEnv, status: "HEALTHY" } }),
    prisma.ciEvidence.findFirst({ where: { kind: "MONITORING_SELFTEST" }, orderBy: { createdAt: "desc" } }),
    prisma.slowQueryStat.count({ where: { lastSeenAt: { gte: dayAgo } } }),
  ]);
  void publicState;

  const highFindings = ((integrity?.findings as Array<{ severity: string }> | null) ?? []).filter((f) => f.severity === "HIGH").length;
  const hoursSince = (d: Date | null | undefined) => (d ? (Date.now() - d.getTime()) / 3_600_000 : null);
  const daysSince = (d: Date | null | undefined) => (d ? (Date.now() - d.getTime()) / 86_400_000 : null);
  const twoFactorRoles = Array.isArray(appSettings?.twoFactorRequiredRoles) ? (appSettings?.twoFactorRequiredRoles as string[]) : typeof appSettings?.twoFactorRequiredRoles === "string" ? String(appSettings.twoFactorRequiredRoles).split(",").map((s) => s.trim()) : [];

  return {
    appEnv: resolveAppEnv(env),
    configIssues: issues,
    evidence,
    evidenceMaxAgeDays: control.evidenceMaxAgeDays,
    health: { dbOk: readiness.checks.database === "ok", overall: health.status, ready: readiness.ready },
    migrations,
    headers,
    rateLimitProbeOk: probe.count === 2,
    stateEndpointOk: publicState != null,
    backup: {
      enabled: control.backupsEnabled,
      keyConfigured: Boolean(env.BACKUP_ENCRYPTION_KEY?.trim()),
      separateStore: Boolean(env.BACKUP_BLOB_READ_WRITE_TOKEN?.trim()),
      lastSuccessAgeHours: hoursSince(lastGood?.startedAt),
      backupStaleAfterHours: control.backupStaleAfterHours,
      lastVerifiedPassed: lastVerifiedRun?.verificationStatus === "PASSED",
      failedCount: failedBackups,
      restoreTestStatus: lastRestore?.status ?? null,
      restoreTestAgeDays: daysSince(lastRestore?.startedAt),
      restoreTestStaleAfterDays: control.restoreTestStaleAfterDays,
      fileSources,
      fileMirrored,
      fileLastRunFailed: lastFileRun?.status === "FAILED",
    },
    jobs: { workerStatus: worker?.lastStatus ?? null, workerAgeHours: hoursSince(worker?.lastCompletedAt), alertEvalAgeHours: hoursSince(alertEval?.lastCompletedAt), deadLetter, tickConsecutiveFailures: tick?.consecutiveFailures ?? 0 },
    alerts: { openCritical },
    integrity: { status: integrity?.status ?? null, ageDays: daysSince(integrity?.startedAt), highFindings },
    payments: {
      provider: payment.activeProvider,
      activeBankAccounts: bankAccounts,
      stage: payment.rolloutStage,
      envSafe: payment.environmentSafety.ok,
      checklist,
      reconciliationClean: latestRecon ? latestRecon.discrepancyCount === 0 : null,
      killSwitchExercised: killSwitch > 0,
      webhooksEnabled: appSettings?.providerWebhooksEnabled ?? true,
    },
    comms: { email: Boolean(env.EMAIL_PROVIDER_API_KEY?.trim()), sms: Boolean(env.SMS_PROVIDER_API_KEY?.trim()), whatsappEnabled: env.WHATSAPP_ENABLED === "true", whatsappConfigured: Boolean(env.WHATSAPP_API_KEY?.trim()) },
    security: { twoFactorRoles, adminSessionMaxHours: control.adminSessionMaxHours, legacyUnencryptedPhotos: legacyPhotos, lockoutConfigured: (appSettings?.loginMaxAttempts ?? 0) > 0 },
    release: { hasCurrent: Boolean(release), healthy: release?.status === "HEALTHY", approved: Boolean(release?.approvedAt), hasRollbackTarget: previousHealthy > (release?.status === "HEALTHY" ? 1 : 0) },
    selfTest: { status: selfTest?.status ?? null, ageDays: daysSince(selfTest?.createdAt) },
    storage: { tokenConfigured: Boolean(env.BLOB_READ_WRITE_TOKEN?.trim()) },
    performance: { slowQueryRows24h: slow },
    drTargetsConfigured: control.rpoMinutes > 0 && control.rtoMinutes > 0,
  };
}

export async function getReadinessReport() {
  const facts = await gatherReadinessFacts();
  return { facts, ...evaluateReadiness(facts) };
}

// Proves the monitoring pipeline end-to-end against the real database:
// error captured → stored → readable; alert raised → transitioned; then both
// are cleaned up. Recorded as evidence so the Monitoring gate has proof.
export async function runMonitoringSelfTest(actorId: string): Promise<{ passed: boolean; steps: Array<{ step: string; ok: boolean }> }> {
  const steps: Array<{ step: string; ok: boolean }> = [];
  const marker = `selftest-${randomUUID().slice(0, 8)}`;
  try {
    await captureError({ error: new Error(`Monitoring self-test ${marker}`), route: "selftest", service: "SELFTEST", category: "SYSTEM_ERROR", severity: "LOW" });
    const stored = await prisma.errorEvent.findFirst({ where: { route: "selftest", message: { contains: "Monitoring self-test" } }, orderBy: { lastSeenAt: "desc" } });
    steps.push({ step: "Error captured and stored", ok: Boolean(stored) });
    if (stored) await prisma.errorEvent.update({ where: { id: stored.id }, data: { status: "RESOLVED", resolvedAt: new Date(), resolvedById: actorId } });

    const alert = await raiseAlert({ category: "SELFTEST", severity: "INFO", source: "self-test", service: "monitoring", title: "Monitoring self-test alert", dedupKey: `selftest:${marker}` });
    steps.push({ step: "Alert raised", ok: Boolean(alert.id) });
    const resolved = await changeAlertStatus({ alertId: alert.id, toStatus: "RESOLVED", actorId, note: "Self-test cleanup" });
    steps.push({ step: "Alert lifecycle transition", ok: resolved.status === "RESOLVED" });

    await writeAudit({ action: "SYSTEM_SETTING_CHANGED", adminId: actorId, meta: { event: "MONITORING_SELFTEST", marker } });
    const audited = await prisma.auditLog.findFirst({ where: { adminId: actorId, action: "SYSTEM_SETTING_CHANGED", meta: { contains: marker } } });
    steps.push({ step: "Audit record written", ok: Boolean(audited) });
  } catch {
    steps.push({ step: "Self-test execution", ok: false });
  }
  const passed = steps.length >= 4 && steps.every((s) => s.ok);
  await prisma.ciEvidence.create({ data: { kind: "MONITORING_SELFTEST", status: passed ? "PASS" : "FAIL", commitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? "local", environment: resolveAppEnv(process.env), summary: { steps } } });
  return { passed, steps };
}
