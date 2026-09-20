import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { getHealthReport } from "@/lib/ops/health";
import { getConfigReport, getServerConfig } from "@/lib/config/server-config";
import { getSystemControl } from "@/lib/ops/system-control";
import { getPaymentSystemHealth } from "@/lib/finance/rollout";
import { readCounter } from "@/lib/observability/metrics";
import { appliedMigrations } from "@/lib/ops/releases";

// Detailed System Health (spec §12). Everything here is secret-free: config is
// reported as presence flags + issues, never values.
export async function GET() {
  try {
    await requireAdmin("system:view");
    const cfg = getServerConfig();
    const dayAgo = new Date(Date.now() - 24 * 3_600_000);
    const hourAgo = new Date(Date.now() - 3_600_000);

    const [health, control, payments, jobCounts, dbSize, photoBytes, docBytes, evidenceBytes, failedLogins, violations, storageErrors, commFailures, migrations, release, tick, slowTop, errorCounts, webhookFailures] = await Promise.all([
      getHealthReport({ detail: true }),
      getSystemControl(),
      getPaymentSystemHealth(),
      prisma.backgroundJob.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.$queryRaw<Array<{ bytes: bigint }>>`SELECT pg_database_size(current_database()) AS bytes`,
      prisma.profilePhoto.aggregate({ _sum: { sizeBytes: true }, _count: true }),
      prisma.verificationDocument.aggregate({ _sum: { sizeBytes: true }, _count: true }),
      prisma.caseEvidence.aggregate({ _sum: { sizeBytes: true }, _count: true }),
      prisma.adminLoginHistory.count({ where: { event: "FAILURE", createdAt: { gte: dayAgo } } }),
      readCounter("security:violations", 24),
      readCounter("errors:storage", 24),
      prisma.communicationLog.groupBy({ by: ["channel"], where: { deliveryStatus: "FAILED", createdAt: { gte: dayAgo } }, _count: { _all: true } }),
      appliedMigrations(),
      cfg.commitSha ? prisma.release.findUnique({ where: { commitSha_environment: { commitSha: cfg.commitSha, environment: cfg.appEnv } } }) : Promise.resolve(null),
      prisma.cronTask.findUnique({ where: { name: "daily-tick" } }),
      prisma.slowQueryStat.findMany({ where: { lastSeenAt: { gte: dayAgo } }, orderBy: { maxMs: "desc" }, take: 5 }),
      prisma.errorEvent.groupBy({ by: ["severity"], where: { lastSeenAt: { gte: hourAgo }, status: { not: "RESOLVED" } }, _count: { _all: true } }),
      prisma.paymentWebhookEvent.count({ where: { status: "FAILED", receivedAt: { gte: dayAgo } } }),
    ]);

    const fileBytes = (photoBytes._sum.sizeBytes ?? 0) + (docBytes._sum.sizeBytes ?? 0) + (evidenceBytes._sum.sizeBytes ?? 0);
    return NextResponse.json({
      health,
      application: { environment: cfg.appEnv, version: cfg.appVersion, commit: cfg.commitSha?.slice(0, 7) ?? null, release: release ? { code: release.releaseCode, status: release.status, deployedAt: release.deployedAt } : null, operationalState: control.operationalState },
      database: { latencyMs: health.checks.database.latencyMs ?? null, sizeMb: Math.round(Number(dbSize[0]?.bytes ?? 0) / 1_048_576), migrationsTracked: migrations != null, migrationsApplied: migrations?.length ?? 0, lastMigration: migrations?.at(-1) ?? null, slowestRecent: slowTop.map((s) => ({ operation: s.operation, table: s.tableName, route: s.route, maxMs: s.maxMs })), poolNote: "Neon pooled connection (pgbouncer); pool internals are not exposed by the driver." },
      storage: { tokenConfigured: Boolean(process.env.BLOB_READ_WRITE_TOKEN), files: { photos: photoBytes._count, documents: docBytes._count, evidence: evidenceBytes._count }, totalMb: Math.round((fileBytes / 1_048_576) * 10) / 10, storageErrors24h: storageErrors },
      payments,
      communications: { email: Boolean(process.env.EMAIL_PROVIDER_API_KEY), sms: Boolean(process.env.SMS_PROVIDER_API_KEY), whatsappEnabled: process.env.WHATSAPP_ENABLED === "true", failedDeliveries24h: commFailures.map((c) => ({ channel: c.channel, count: c._count._all })) },
      jobs: { counts: Object.fromEntries(jobCounts.map((j) => [j.status, j._count._all])), tick: tick ? { lastCompletedAt: tick.lastCompletedAt, lastStatus: tick.lastStatus, consecutiveFailures: tick.consecutiveFailures } : null },
      security: { failedAdminLogins24h: failedLogins, permissionViolations24h: violations, webhookFailures24h: webhookFailures },
      errors: { openLastHour: Object.fromEntries(errorCounts.map((e) => [e.severity, e._count._all])) },
      config: getConfigReport(),
      thresholds: control,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
