import { prisma } from "@/lib/prisma";
import { getServerConfig } from "@/lib/config/server-config";
import { getHealthReport } from "@/lib/ops/health";
import { appliedMigrations } from "@/lib/ops/releases";
import { getAllFeatureFlags } from "@/lib/ops/feature-flags";
import { FEATURE_FLAG_DEFS } from "@/lib/ops/feature-flag-defs";
import { getSystemControl, SWITCH_FIELD } from "@/lib/ops/system-control";

// STEP 34 §30/§45 - everything the /admin/deployment page shows. Read-only, and it carries NO secret: only names, versions, timestamps and
// on/off states. Anything unknown is reported as null ("not recorded") - never guessed.

export async function getDeploymentInfo() {
  const cfg = getServerConfig();
  const [current, previous, migrations, health, flags, control, lastBackup, lastVerifiedBackup, lastRestoreTest, lastDrill, lastSmoke] = await Promise.all([
    cfg.commitSha ? prisma.release.findUnique({ where: { commitSha_environment: { commitSha: cfg.commitSha, environment: cfg.appEnv } } }) : Promise.resolve(null),
    prisma.release.findFirst({ where: { environment: cfg.appEnv, status: "HEALTHY", ...(cfg.commitSha ? { commitSha: { not: cfg.commitSha } } : {}) }, orderBy: { deployedAt: "desc" } }),
    appliedMigrations(),
    getHealthReport({ detail: false }),
    getAllFeatureFlags(),
    getSystemControl(),
    prisma.backupRun.findFirst({ where: { type: "DATABASE" }, orderBy: { startedAt: "desc" }, select: { backupCode: true, status: true, startedAt: true } }),
    prisma.backupRun.findFirst({ where: { type: "DATABASE", status: "COMPLETED" }, orderBy: { startedAt: "desc" }, select: { backupCode: true, startedAt: true } }),
    prisma.restoreTest.findFirst({ orderBy: { startedAt: "desc" }, select: { startedAt: true, status: true } }),
    prisma.restoreDrill.findFirst({ orderBy: { startedAt: "desc" }, select: { startedAt: true, status: true, reviewedAt: true } }),
    prisma.ciEvidence.findFirst({ where: { kind: "SMOKE" }, orderBy: { createdAt: "desc" }, select: { createdAt: true, status: true, commitSha: true } }),
  ]);

  return {
    environment: cfg.appEnv,
    version: cfg.appVersion,
    commitSha: cfg.commitSha,
    deployedAt: current?.deployedAt ?? null,
    release: current ? { code: current.releaseCode, status: current.status, verifiedAt: current.verifiedAt } : null,
    previous: previous ? { code: previous.releaseCode, version: previous.version, commitSha: previous.commitSha, deployedAt: previous.deployedAt } : null,
    lastMigration: migrations && migrations.length ? migrations[migrations.length - 1] : null,
    migrationCount: migrations?.length ?? null,
    health: { overall: health.status, checks: Object.fromEntries(Object.entries(health.checks).map(([k, v]) => [k, v.status])) },
    backup: { latest: lastBackup, latestVerified: lastVerifiedBackup },
    lastRestoreTest,
    lastRestoreDrill: lastDrill,
    lastSmoke,
    switches: Object.fromEntries(Object.entries(SWITCH_FIELD).map(([k, field]) => [k, Boolean(control[field])])),
    flags: FEATURE_FLAG_DEFS.map((d) => ({ key: d.key, enabled: flags[d.key] ?? true, sensitive: d.sensitive })),
  };
}
