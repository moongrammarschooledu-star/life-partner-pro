import { prisma } from "@/lib/prisma";
import { getSystemControl } from "@/lib/ops/system-control";

// STEP 32 — what the Security Operations screens may say about backups. A read model over BackupRun / RestoreTest / SystemControl, and
// nothing else: it never starts, edits or deletes a backup, and it NEVER returns a storage location, a key or any file content (the select
// below names every field it reads, and the location is reduced to a yes/no before it leaves this module).
//
// HEALTHY is claimed only when there is a COMPLETED database backup, it passed the integrity verification, and it is newer than the
// configured limit. Everything else says what is missing instead of looking fine.

export type BackupHealth = "HEALTHY" | "WARNING" | "FAILED" | "NONE" | "DISABLED";

export interface HealthInput {
  backupsEnabled: boolean;
  staleAfterHours: number;
  now: Date;
  latestAttempt: { status: "RUNNING" | "COMPLETED" | "FAILED"; startedAt: Date } | null;
  latestCompleted: { startedAt: Date; verificationStatus: string | null } | null;
}

// Pure.
export function backupHealth(i: HealthInput): { health: BackupHealth; reasons: string[] } {
  if (!i.backupsEnabled) return { health: "DISABLED", reasons: ["Backups are switched off in System Control."] };
  if (!i.latestCompleted) return { health: "NONE", reasons: ["No completed database backup exists."] };
  const reasons: string[] = [];
  let health: BackupHealth = "HEALTHY";
  if (i.latestAttempt?.status === "FAILED" && i.latestAttempt.startedAt >= i.latestCompleted.startedAt) {
    health = "FAILED";
    reasons.push("The most recent backup attempt failed.");
  }
  if (i.latestCompleted.verificationStatus === "FAILED") {
    health = "FAILED";
    reasons.push("The latest backup failed its integrity verification.");
  } else if (i.latestCompleted.verificationStatus !== "PASSED") {
    if (health === "HEALTHY") health = "WARNING";
    reasons.push("The latest backup has not been verified yet.");
  }
  const ageHours = (i.now.getTime() - i.latestCompleted.startedAt.getTime()) / 3_600_000;
  if (ageHours > i.staleAfterHours) {
    if (health === "HEALTHY") health = "WARNING";
    reasons.push(`The latest completed backup is ${Math.round(ageHours)} hours old (limit ${i.staleAfterHours} hours).`);
  }
  return { health, reasons };
}

const RUN_FIELDS = { id: true, backupCode: true, type: true, trigger: true, status: true, retentionClass: true, startedAt: true, completedAt: true, sizeBytes: true, encrypted: true, separateStore: true, verifiedAt: true, verificationStatus: true, failureReason: true, storageUrl: true, prunedAt: true } as const;

type RunRow = { id: string; backupCode: string; type: string; trigger: string; status: string; retentionClass: string; startedAt: Date; completedAt: Date | null; sizeBytes: number | null; encrypted: boolean; separateStore: boolean; verifiedAt: Date | null; verificationStatus: string | null; failureReason: string | null; storageUrl: string | null; prunedAt: Date | null };

function present(r: RunRow) {
  return {
    id: r.id, code: r.backupCode, type: r.type, trigger: r.trigger, status: r.status, retentionClass: r.retentionClass, startedAt: r.startedAt, completedAt: r.completedAt,
    sizeBytes: r.sizeBytes, encrypted: r.encrypted, storedOffsite: !!r.storageUrl && !r.storageUrl.startsWith("file:"), separateStore: r.separateStore,
    verifiedAt: r.verifiedAt, verification: r.verificationStatus, failureReason: r.failureReason, pruned: !!r.prunedAt,
  };
}

export async function backupOverview(now: Date = new Date()) {
  const control = await getSystemControl();
  const [recent, latestAttempt, latestCompletedDb, latestCompletedFiles, failed30, running, lastTests] = await Promise.all([
    prisma.backupRun.findMany({ orderBy: { startedAt: "desc" }, take: 20, select: RUN_FIELDS }),
    prisma.backupRun.findFirst({ where: { type: "DATABASE" }, orderBy: { startedAt: "desc" }, select: RUN_FIELDS }),
    prisma.backupRun.findFirst({ where: { type: "DATABASE", status: "COMPLETED", prunedAt: null }, orderBy: { startedAt: "desc" }, select: RUN_FIELDS }),
    prisma.backupRun.findFirst({ where: { type: "FILES", status: "COMPLETED" }, orderBy: { startedAt: "desc" }, select: RUN_FIELDS }),
    prisma.backupRun.count({ where: { status: "FAILED", startedAt: { gte: new Date(now.getTime() - 30 * 86_400_000) } } }),
    prisma.backupRun.count({ where: { status: "RUNNING" } }),
    prisma.restoreTest.findMany({ orderBy: { startedAt: "desc" }, take: 5, select: { id: true, mode: true, status: true, startedAt: true, completedAt: true } }),
  ]);
  const verdict = backupHealth({
    backupsEnabled: control.backupsEnabled, staleAfterHours: control.backupStaleAfterHours, now,
    latestAttempt: latestAttempt ? { status: latestAttempt.status as "RUNNING" | "COMPLETED" | "FAILED", startedAt: latestAttempt.startedAt } : null,
    latestCompleted: latestCompletedDb ? { startedAt: latestCompletedDb.startedAt, verificationStatus: latestCompletedDb.verificationStatus } : null,
  });
  const lastVerified = await prisma.backupRun.findFirst({ where: { type: "DATABASE", status: "COMPLETED", verificationStatus: "PASSED" }, orderBy: { startedAt: "desc" }, select: RUN_FIELDS });
  return {
    enabled: control.backupsEnabled,
    health: verdict.health,
    reasons: verdict.reasons,
    latestDatabase: latestCompletedDb ? present(latestCompletedDb as RunRow) : null,
    latestFiles: latestCompletedFiles ? present(latestCompletedFiles as RunRow) : null,
    lastVerified: lastVerified ? present(lastVerified as RunRow) : null,
    counts: { failedLast30Days: failed30, running },
    retention: { daily: control.backupDailyKeep, weekly: control.backupWeeklyKeep, monthly: control.backupMonthlyKeep, staleAfterHours: control.backupStaleAfterHours },
    // Storage facts come from the backup records themselves; a location is reduced to "off-site yes/no" and never shown.
    storage: {
      encrypted: latestCompletedDb ? latestCompletedDb.encrypted : null,
      offsite: latestCompletedDb ? !!latestCompletedDb.storageUrl && !latestCompletedDb.storageUrl.startsWith("file:") : null,
      separateStore: latestCompletedDb ? latestCompletedDb.separateStore : null,
      note: "Backup files are encrypted before they leave the application. Their locations and keys are never shown here.",
    },
    recent: (recent as RunRow[]).map(present),
    restoreVerifications: lastTests,
    verificationNote: "A verification checks that a backup can be decrypted and that its checksum and row counts match. It is NOT proof that a restore works: that needs a restore drill in an isolated environment.",
  };
}
