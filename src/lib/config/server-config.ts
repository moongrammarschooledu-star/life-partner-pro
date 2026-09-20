import "server-only";
import { validateConfig, describeConfig, resolveAppEnv, type AppEnv, type ConfigIssue } from "@/lib/config/validate";

// Single server-side entry point for configuration (spec §2/§3). `server-only`
// makes any client-component import a build error, so nothing here can leak
// into a browser bundle. Values that are secrets are never returned by
// getConfigReport() — only presence.

export interface ServerConfig {
  appEnv: AppEnv;
  appVersion: string;
  commitSha: string | null;
  appUrl: string | null;
  logLevel: "DEBUG" | "INFO" | "WARN" | "ERROR" | "CRITICAL";
  cspMode: "enforce" | "report-only";
  slowQueryThresholdMs: number;
  alertWebhookUrl: string | null;
  ciEvidenceToken: string | null;
  cronSecret: string | null;
}

let cached: ServerConfig | null = null;

export function getServerConfig(): ServerConfig {
  if (cached) return cached;
  const env = process.env;
  const appEnv = resolveAppEnv(env);
  const level = (env.LOG_LEVEL ?? (appEnv === "production" ? "INFO" : "DEBUG")).toUpperCase();
  cached = {
    appEnv,
    appVersion: env.APP_VERSION ?? "0.0.0",
    commitSha: env.VERCEL_GIT_COMMIT_SHA ?? null,
    appUrl: env.APP_URL?.trim() || null,
    logLevel: (["DEBUG", "INFO", "WARN", "ERROR", "CRITICAL"].includes(level) ? level : "INFO") as ServerConfig["logLevel"],
    cspMode: env.CSP_MODE === "enforce" ? "enforce" : "report-only",
    slowQueryThresholdMs: Number(env.SLOW_QUERY_THRESHOLD_MS) > 0 ? Number(env.SLOW_QUERY_THRESHOLD_MS) : 500,
    alertWebhookUrl: env.ALERT_WEBHOOK_URL?.trim() || null,
    ciEvidenceToken: env.CI_EVIDENCE_TOKEN?.trim() || null,
    cronSecret: env.CRON_SECRET?.trim() || null,
  };
  return cached;
}

export function getConfigReport(): { appEnv: AppEnv; issues: ConfigIssue[]; present: Record<string, { present: boolean }> } {
  const { appEnv, issues } = validateConfig(process.env);
  return { appEnv, issues, present: describeConfig(process.env) };
}
