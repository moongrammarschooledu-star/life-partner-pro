import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { getServerConfig } from "@/lib/config/server-config";
import { validateConfig, hasCritical } from "@/lib/config/validate";
import { getSystemControl } from "@/lib/ops/system-control";
import { checkDatabase } from "@/lib/ops/health";
import { logger } from "@/lib/observability/logger";
import { FEATURE_FLAG_DEFAULTS } from "@/lib/ops/feature-flag-defs";

// Release records (spec §25/§26/§60/§62/§63). A release is registered once
// per (commit, environment) the first time an instance of a new deployment
// starts, then self-verified. "Build finished" is NOT success: HEALTHY needs
// a passing post-deploy verification (DB + config + readiness).

export async function appliedMigrations(): Promise<string[] | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ migration_name: string }>>`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name`;
    return rows.map((r) => r.migration_name);
  } catch {
    return null; // table absent (db-push era) — recorded as unknown, never guessed
  }
}

export async function registerReleaseOnStartup(): Promise<void> {
  const cfg = getServerConfig();
  if (!cfg.commitSha) return; // local development: no deployment to record

  const existing = await prisma.release.findUnique({ where: { commitSha_environment: { commitSha: cfg.commitSha, environment: cfg.appEnv } } });
  if (existing) return;

  const control = await getSystemControl();
  const previous = await prisma.release.findFirst({ where: { environment: cfg.appEnv, status: "HEALTHY" }, orderBy: { deployedAt: "desc" } });
  const flags = await prisma.featureFlag.findMany();
  const flagSnapshot: Record<string, boolean> = { ...FEATURE_FLAG_DEFAULTS };
  for (const f of flags) flagSnapshot[f.key] = f.enabled;

  let release;
  try {
    release = await prisma.release.create({
      data: {
        releaseCode: await nextSequenceCode("REL"),
        version: `${cfg.appVersion}+${cfg.commitSha.slice(0, 7)}`,
        commitSha: cfg.commitSha,
        environment: cfg.appEnv,
        status: "DEPLOYING",
        deployedBy: process.env.VERCEL_GIT_COMMIT_AUTHOR_LOGIN ?? null,
        notes: process.env.VERCEL_GIT_COMMIT_MESSAGE?.slice(0, 300) ?? null,
        migrations: (await appliedMigrations()) ?? undefined,
        featureFlags: flagSnapshot,
        paymentEnvironment: process.env.PAYMENT_ENVIRONMENT ?? null,
        rollbackTargetId: previous?.id ?? null,
        monitoringUntil: new Date(Date.now() + control.monitoringPeriodHours * 3_600_000),
      },
    });
  } catch {
    return; // another instance registered the same release first (unique constraint) — expected
  }

  await writeAudit({ action: "DEPLOYMENT_STARTED", meta: { releaseId: release.id, releaseCode: release.releaseCode, version: release.version, environment: cfg.appEnv } });
  await verifyRelease(release.id);
}

export async function verifyRelease(releaseId: string): Promise<{ healthy: boolean; checks: Record<string, string> }> {
  const db = await checkDatabase();
  const { issues } = validateConfig(process.env);
  const checks = { database: db.status, configuration: hasCritical(issues) ? "critical_issue" : "ok" };
  const healthy = db.status === "ok" && !hasCritical(issues);

  const release = await prisma.release.update({
    where: { id: releaseId },
    data: { status: healthy ? "HEALTHY" : "UNHEALTHY", verifiedAt: new Date(), verificationResult: checks },
  });
  await writeAudit({ action: healthy ? "DEPLOYMENT_COMPLETED" : "DEPLOYMENT_FAILED", meta: { releaseId, releaseCode: release.releaseCode, checks } });
  logger.info("release_verified", { releaseCode: release.releaseCode, healthy });

  if (!healthy) {
    const { raiseAlert } = await import("@/lib/ops/alerts");
    await raiseAlert({ category: "DEPLOYMENT_UNHEALTHY", severity: "CRITICAL", source: "release", service: "deployment", title: `Release ${release.releaseCode} failed post-deploy verification`, detail: JSON.stringify(checks), dedupKey: `release:${releaseId}` });
  }
  return { healthy, checks };
}
