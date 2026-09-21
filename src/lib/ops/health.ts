import { prisma } from "@/lib/prisma";
import { getSystemControl } from "@/lib/ops/system-control";
import { validateConfig, hasCritical } from "@/lib/config/validate";
import { getServerConfig } from "@/lib/config/server-config";

// Health checks (spec §11/§12). Statuses only on the public surface; details
// (still secret-free) only when `detail: true` for the admin dashboard.
// Liveness = process is up (no dependencies). Readiness = can safely serve.

export type CheckStatus = "ok" | "degraded" | "down" | "not_configured" | "unknown";
export interface HealthCheck {
  status: CheckStatus;
  detail?: string;
  latencyMs?: number;
}
export interface HealthReport {
  status: "ok" | "degraded" | "down";
  timestamp: string;
  version: string;
  environment: string;
  checks: Record<string, HealthCheck>;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}

export async function checkDatabase(): Promise<HealthCheck & { latencyMs: number }> {
  const start = Date.now();
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, 3000);
    return { status: "ok", latencyMs: Date.now() - start };
  } catch (error) {
    return { status: "down", latencyMs: Date.now() - start, detail: error instanceof Error && error.message === "timeout" ? "Query timed out" : "Connection failed" };
  }
}

export async function getReadiness(): Promise<{ ready: boolean; checks: Record<string, string> }> {
  const { issues } = validateConfig(process.env);
  const db = await checkDatabase();
  let state = "UNKNOWN";
  try {
    state = (await getSystemControl()).operationalState;
  } catch {
    // DB down — already reflected in the database check
  }
  const checks = { database: db.status === "ok" ? "ok" : "fail", config: hasCritical(issues) ? "fail" : "ok", state };
  const ready = checks.database === "ok" && checks.config === "ok" && state !== "RECOVERY" && state !== "EMERGENCY";
  return { ready, checks };
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export async function getHealthReport(opts: { detail: boolean }): Promise<HealthReport> {
  const cfg = getServerConfig();
  const env = process.env;
  const checks: Record<string, HealthCheck> = {};
  const add = (name: string, status: CheckStatus, detail?: string, latencyMs?: number) => {
    checks[name] = opts.detail ? { status, detail, latencyMs } : { status };
  };

  add("application", "ok");

  const db = await checkDatabase();
  add("database", db.status, db.detail, db.latencyMs);

  const { issues } = validateConfig(env);
  add("configuration", hasCritical(issues) ? "down" : issues.some((i) => i.severity === "BLOCKER") ? "degraded" : "ok", hasCritical(issues) ? "Critical configuration issue" : undefined);

  add("storage", env.BLOB_READ_WRITE_TOKEN ? "ok" : "not_configured", env.BLOB_READ_WRITE_TOKEN ? "Storage token present" : "No storage token");
  add("authentication", env.NEXTAUTH_SECRET || env.AUTH_SECRET ? "ok" : "down", "Session secret present");

  if (db.status === "ok") {
    const control = await safe(() => getSystemControl(), null);
    const queueThreshold = control?.queueBacklogThreshold ?? 100;

    const [backlog, deadLetter] = await Promise.all([
      safe(() => prisma.backgroundJob.count({ where: { status: { in: ["PENDING", "RETRYING"] }, runAfter: { lte: new Date(Date.now() - 60 * 60 * 1000) } } }), 0),
      safe(() => prisma.backgroundJob.count({ where: { status: "DEAD_LETTER", resolved: false } }), 0),
    ]);
    add("queue", backlog > queueThreshold ? "degraded" : "ok", `${backlog} overdue, ${deadLetter} dead-letter`);

    const cron = await safe(() => prisma.cronTask.findUnique({ where: { name: "daily-tick" } }), null);
    if (!cron?.lastCompletedAt) add("cron", "unknown", "No completed run recorded yet");
    else {
      const ageH = (Date.now() - cron.lastCompletedAt.getTime()) / 3_600_000;
      add("cron", ageH > 36 || cron.consecutiveFailures >= 3 ? "degraded" : "ok", `Last completed ${Math.round(ageH)}h ago, ${cron.consecutiveFailures} consecutive failures`);
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [failedWebhooks, failedPayments] = await Promise.all([
      safe(() => prisma.paymentWebhookEvent.count({ where: { status: "FAILED", receivedAt: { gte: since } } }), 0),
      safe(() => prisma.payment.count({ where: { status: "FAILED", createdAt: { gte: since } } }), 0),
    ]);
    add("webhooks", failedWebhooks >= (control?.webhookFailureSpikeThreshold ?? 5) ? "degraded" : "ok", `${failedWebhooks} failed in 24h`);
    add("payments", failedPayments >= (control?.paymentFailureSpikeThreshold ?? 5) ? "degraded" : "ok", `${failedPayments} failed in 24h`);
    add("system_state", control && control.operationalState !== "NORMAL" ? "degraded" : "ok", control?.operationalState);
  } else {
    for (const name of ["queue", "cron", "webhooks", "payments", "system_state"]) add(name, "unknown", "Database unavailable");
  }

  const emailOn = Boolean(env.SMTP_USER?.trim() && env.SMTP_PASS?.trim());
  add("email", emailOn ? "ok" : "not_configured", emailOn ? "SMTP credentials present (delivery not probed)" : "Messages are logged, not delivered");
  add("sms", env.SMS_PROVIDER_API_KEY ? "ok" : "not_configured", env.SMS_PROVIDER_API_KEY ? "Provider key present" : "Messages are logged, not delivered");
  add("whatsapp", env.WHATSAPP_ENABLED === "true" ? (env.WHATSAPP_API_KEY ? "ok" : "degraded") : "not_configured", env.WHATSAPP_ENABLED === "true" ? undefined : "Disabled");

  const values = Object.values(checks).map((c) => c.status);
  const status: HealthReport["status"] = checks.database.status === "down" || checks.authentication.status === "down" ? "down" : values.includes("degraded") || values.includes("down") ? "degraded" : "ok";

  return { status, timestamp: new Date().toISOString(), version: cfg.commitSha ? `${cfg.appVersion}+${cfg.commitSha.slice(0, 7)}` : cfg.appVersion, environment: cfg.appEnv, checks };
}
