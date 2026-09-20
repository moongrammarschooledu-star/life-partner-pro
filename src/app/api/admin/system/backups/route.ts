import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { readJson } from "@/lib/ops/admin-route";
import { getSystemControl } from "@/lib/ops/system-control";
import { createDatabaseBackup, pruneBackups } from "@/lib/backup/export";
import { mirrorFiles } from "@/lib/backup/files";
import { verifyBackup } from "@/lib/backup/verify";
import { enforcePersistentLimit } from "@/lib/ops/rate-limit-persistent";
import { confirmationPhraseFor } from "@/lib/backup/pure";

export const maxDuration = 60;

// Backup & Recovery status (spec §8). Never returns storage URLs, keys or any
// file content — only metadata and counts.
export async function GET() {
  try {
    await requireAdmin("system:backup:view");
    const control = await getSystemControl();
    const [runs, tests, requests, failed, lastGood, fileSources, fileMirrored] = await Promise.all([
      prisma.backupRun.findMany({ orderBy: { startedAt: "desc" }, take: 30, select: { id: true, backupCode: true, type: true, trigger: true, status: true, retentionClass: true, startedAt: true, completedAt: true, sizeBytes: true, encrypted: true, separateStore: true, verifiedAt: true, verificationStatus: true, failureReason: true, prunedAt: true, manifest: true } }),
      prisma.restoreTest.findMany({ orderBy: { startedAt: "desc" }, take: 10, include: { backup: { select: { backupCode: true } } } }),
      prisma.restoreRequest.findMany({ orderBy: { requestedAt: "desc" }, take: 10, include: { backup: { select: { backupCode: true } } } }),
      prisma.backupRun.count({ where: { status: "FAILED" } }),
      prisma.backupRun.findFirst({ where: { type: "DATABASE", status: "COMPLETED", prunedAt: null }, orderBy: { startedAt: "desc" } }),
      Promise.all([prisma.profilePhoto.count(), prisma.verificationDocument.count(), prisma.caseEvidence.count()]).then((a) => a.reduce((x, y) => x + y, 0)),
      prisma.backupFileCopy.count(),
    ]);

    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 8, 0, 0));
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);

    return NextResponse.json({
      summary: {
        lastSuccessful: lastGood ? { backupCode: lastGood.backupCode, at: lastGood.startedAt, sizeBytes: lastGood.sizeBytes, verification: lastGood.verificationStatus, retentionClass: lastGood.retentionClass } : null,
        lastRestoreTest: tests[0] ? { at: tests[0].startedAt, status: tests[0].status, backupCode: tests[0].backup.backupCode, result: tests[0].result } : null,
        failedBackupCount: failed,
        nextScheduledBackup: control.backupsEnabled ? next.toISOString() : null,
        fileMirror: { sources: fileSources, mirrored: fileMirrored },
      },
      configuration: { encryptionKeyConfigured: Boolean(process.env.BACKUP_ENCRYPTION_KEY?.trim()), separateStorageConfigured: Boolean(process.env.BACKUP_BLOB_READ_WRITE_TOKEN?.trim()), backupsEnabled: control.backupsEnabled, policy: { daily: control.backupDailyKeep, weekly: control.backupWeeklyKeep, monthly: control.backupMonthlyKeep }, rpoMinutes: control.rpoMinutes, rtoMinutes: control.rtoMinutes },
      runs,
      restoreTests: tests,
      restoreRequests: requests,
      confirmationPhraseHint: "RESTORE <backup code>",
      exampleConfirmation: lastGood ? confirmationPhraseFor(lastGood.backupCode) : null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("system:backup:trigger");
    const limited = await enforcePersistentLimit(req, "admin-backup", 5, 600_000, admin.id);
    if (limited) return limited;

    const body = await readJson<{ action?: string; backupId?: string }>(req);
    if (body.action === "backup_db") {
      const outcome = await createDatabaseBackup({ trigger: "MANUAL", actorId: admin.id });
      if (outcome.status === "NOT_CONFIGURED") throw new ApiError(400, outcome.message ?? "Backups are not configured.");
      const verification = outcome.status === "COMPLETED" && outcome.backupId ? await verifyBackup(outcome.backupId, admin.id) : null;
      return NextResponse.json({ outcome, verification: verification ? { passed: verification.passed, checks: verification.checks } : null });
    }
    if (body.action === "backup_files") return NextResponse.json({ outcome: await mirrorFiles({ trigger: "MANUAL", actorId: admin.id }) });
    if (body.action === "verify" && body.backupId) {
      const result = await verifyBackup(body.backupId, admin.id);
      return NextResponse.json({ passed: result.passed, checks: result.checks });
    }
    if (body.action === "prune") return NextResponse.json({ pruned: await pruneBackups() });
    throw new ApiError(400, "Unknown action.");
  } catch (error) {
    return handleApiError(error);
  }
}
