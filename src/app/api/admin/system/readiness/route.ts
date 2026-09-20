import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { readJson } from "@/lib/ops/admin-route";
import { getReadinessReport, runMonitoringSelfTest } from "@/lib/ops/readiness";
import { getServerConfig } from "@/lib/config/server-config";
import { enforcePersistentLimit } from "@/lib/ops/rate-limit-persistent";

export const maxDuration = 60;

// Production Readiness (spec §49/§67/§68/§69). READY can only come from the
// pure evaluator over live facts + fresh CI evidence — there is deliberately
// NO endpoint that sets it manually.
export async function GET() {
  try {
    await requireAdmin("readiness:view");
    const cfg = getServerConfig();
    const report = await getReadinessReport();

    const [lastSmoke, lastSecuritySmoke, lastBackup, lastRestore, openCriticalCases, release] = await Promise.all([
      prisma.ciEvidence.findFirst({ where: { kind: "SMOKE" }, orderBy: { createdAt: "desc" } }),
      prisma.ciEvidence.findFirst({ where: { kind: "SECURITY_SMOKE" }, orderBy: { createdAt: "desc" } }),
      prisma.backupRun.findFirst({ where: { type: "DATABASE", status: "COMPLETED" }, orderBy: { startedAt: "desc" }, select: { startedAt: true, backupCode: true } }),
      prisma.restoreTest.findFirst({ orderBy: { startedAt: "desc" }, select: { startedAt: true, status: true } }),
      prisma.case.count({ where: { type: "SYSTEM_INCIDENT", priority: "CRITICAL", status: { notIn: ["RESOLVED", "CLOSED", "ARCHIVED"] } } }),
      cfg.commitSha ? prisma.release.findUnique({ where: { commitSha_environment: { commitSha: cfg.commitSha, environment: cfg.appEnv } } }) : Promise.resolve(null),
    ]);

    const evidence = await prisma.ciEvidence.findMany({ orderBy: { createdAt: "desc" }, take: 30, select: { id: true, kind: true, status: true, commitSha: true, createdAt: true, environment: true } });
    return NextResponse.json({
      verdict: report.verdict,
      unresolved: report.unresolved,
      gates: report.gates,
      scorecard: report.scorecard,
      status: {
        environment: cfg.appEnv,
        version: cfg.commitSha ? `${cfg.appVersion}+${cfg.commitSha.slice(0, 7)}` : cfg.appVersion,
        database: report.facts.health.dbOk ? "PASS" : "BLOCKED",
        backup: report.gates.find((g) => g.id === "backup_recent")?.status ?? "BLOCKED",
        monitoring: report.gates.find((g) => g.id === "monitor_selftest")?.status ?? "BLOCKED",
        security: report.scorecard.find((s) => s.category === "Security")?.status ?? "BLOCKED",
        payment: report.scorecard.find((s) => s.category === "Payments")?.status ?? "BLOCKED",
        webhook: report.gates.find((g) => g.id === "pay_webhook")?.status ?? "BLOCKED",
        deployment: report.scorecard.find((s) => s.category === "Deployment")?.status ?? "BLOCKED",
        lastSmokeTest: lastSmoke ? { at: lastSmoke.createdAt, status: lastSmoke.status } : null,
        lastSecurityTest: lastSecuritySmoke ? { at: lastSecuritySmoke.createdAt, status: lastSecuritySmoke.status } : null,
        lastBackup: lastBackup ? { at: lastBackup.startedAt, code: lastBackup.backupCode } : null,
        lastRestoreTest: lastRestore ? { at: lastRestore.startedAt, status: lastRestore.status } : null,
        openCriticalIncidents: openCriticalCases,
        release: release ? { code: release.releaseCode, status: release.status } : null,
      },
      evidence,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("system:jobs:manage");
    const limited = await enforcePersistentLimit(req, "admin-readiness", 6, 600_000, admin.id);
    if (limited) return limited;
    const body = await readJson<{ action?: string }>(req);
    if (body.action === "selftest") return NextResponse.json(await runMonitoringSelfTest(admin.id));
    throw new ApiError(400, "Unknown action.");
  } catch (error) {
    return handleApiError(error);
  }
}
