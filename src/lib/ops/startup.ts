import { validateConfig } from "@/lib/config/validate";
import { logger } from "@/lib/observability/logger";

// Runs once per server instance from instrumentation.ts register() (spec §2:
// "validate required environment variables during application startup").
// Deliberately NEVER throws: a bad configuration must degrade safely —
// /api/health/ready reports not_ready and the readiness dashboard shows the
// exact issue — instead of crashing every request.

let done = false;

export async function runStartupChecks(): Promise<void> {
  if (done) return;
  done = true;

  const { appEnv, issues } = validateConfig(process.env);
  for (const issue of issues) {
    if (issue.severity === "CRITICAL") logger.critical("config_issue", { key: issue.key, detail: issue.message, appEnv });
    else if (issue.severity === "BLOCKER" || issue.severity === "WARNING") logger.warn("config_issue", { key: issue.key, detail: issue.message, appEnv, severity: issue.severity });
  }
  logger.info("server_started", { appEnv, issues: issues.length });

  try {
    const { registerReleaseOnStartup } = await import("@/lib/ops/releases");
    await registerReleaseOnStartup();
  } catch (error) {
    logger.warn("release_registration_failed", { reason: error instanceof Error ? error.message : "unknown" });
  }
}
