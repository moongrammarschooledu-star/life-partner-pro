import { createHash } from "crypto";
import { gzipSync } from "zlib";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { logger } from "@/lib/observability/logger";
import { redactString } from "@/lib/observability/redact";
import { getSystemControl } from "@/lib/ops/system-control";
import { deriveBackupKey, encryptBackup } from "@/lib/backup/crypto";
import { retentionClassFor, selectBackupsToPrune } from "@/lib/backup/retention";
import { BACKUP_FORMAT, serializeRecord } from "@/lib/backup/pure";
import { storeBackupObject, deleteBackupObject, usingLocalSink } from "@/lib/backup/storage";

// Logical database backup (spec §6). Exports every model through the Prisma
// data model (DMMF), so new tables are included automatically. Honest limits:
// this is a logical snapshot taken in one pass (not point-in-time consistent
// under concurrent writes), bounded by size and time. If the database is too
// large for a single serverless invocation the run FAILS LOUDLY (never a
// silent partial backup) and the external pg_dump workflow / Neon PITR must be
// used. Row data is never logged.

const EXCLUDED_MODELS = new Set(["BackupRun", "BackupFileCopy", "RestoreTest", "RestoreRequest", "RateLimitBucket", "SlowQueryStat", "PerfSample"]);
const PAGE_SIZE = 500;
const MAX_PLAIN_BYTES = 120 * 1024 * 1024;
const BUDGET_MS = 50_000;
const TABLE_CONCURRENCY = 8;

export function backupModels() {
  return Prisma.dmmf.datamodel.models.filter((m) => !EXCLUDED_MODELS.has(m.name));
}

type Delegate = { findMany: (args: unknown) => Promise<unknown[]>; count: () => Promise<number> };

export function delegateFor(name: string, client: unknown = prisma): Delegate {
  const key = name.charAt(0).toLowerCase() + name.slice(1);
  return (client as Record<string, Delegate>)[key];
}

export function primaryKeyFields(model: (typeof Prisma.dmmf.datamodel.models)[number]): string[] {
  const single = model.fields.find((f) => f.isId);
  if (single) return [single.name];
  return model.primaryKey?.fields ? [...model.primaryKey.fields] : [];
}


// Reads every model through the given client and returns the encrypted backup
// container + manifest. Pure with respect to the database it reads (no BackupRun
// rows are written) so it can also be pointed at a scratch database in tests.
export async function buildBackupPayload(client: unknown, keyMaterial: string): Promise<{ encrypted: Buffer; checksum: string; manifest: Record<string, unknown>; totalRows: number }> {
  const lines: string[] = [];
  const tables: Record<string, number> = {};
  let plainBytes = 0;
  let totalRows = 0;
  const deadline = Date.now() + BUDGET_MS;

  // Tables are read a few at a time: a database with ~110 tables would otherwise
  // pay ~110 sequential round trips (very slow from a distant machine).
  async function readModel(model: ReturnType<typeof backupModels>[number]): Promise<{ name: string; out: string[]; count: number; bytes: number }> {
    const delegate = delegateFor(model.name, client);
    const orderBy = primaryKeyFields(model).map((f) => ({ [f]: "asc" }));
    const out: string[] = [];
    let skip = 0;
    let bytes = 0;
    for (;;) {
      if (Date.now() > deadline) throw new Error("Backup exceeded the serverless time budget — use the external pg_dump workflow / Neon point-in-time recovery for this database size.");
      const rows = await delegate.findMany({ orderBy: orderBy.length ? orderBy : undefined, skip, take: PAGE_SIZE });
      for (const row of rows) {
        const line = serializeRecord(model.name, row);
        bytes += line.length + 1;
        out.push(line);
      }
      skip += rows.length;
      if (rows.length < PAGE_SIZE) break;
    }
    return { name: model.name, out, count: out.length, bytes };
  }

  const models = backupModels();
  for (let i = 0; i < models.length; i += TABLE_CONCURRENCY) {
    const batch = await Promise.all(models.slice(i, i + TABLE_CONCURRENCY).map(readModel));
    for (const result of batch) {
      lines.push(...result.out);
      tables[result.name] = result.count;
      totalRows += result.count;
      plainBytes += result.bytes;
    }
    if (plainBytes > MAX_PLAIN_BYTES) throw new Error("Backup exceeds the maximum in-app size — use the external pg_dump workflow / Neon point-in-time recovery.");
  }

  const encrypted = encryptBackup(gzipSync(Buffer.from(lines.join("\n"), "utf8")), deriveBackupKey(keyMaterial));
  const checksum = createHash("sha256").update(encrypted).digest("hex");
  return { encrypted, checksum, totalRows, manifest: { format: BACKUP_FORMAT, generatedAt: new Date().toISOString(), appVersion: process.env.APP_VERSION ?? null, tables, totalRows } };
}

export interface BackupOutcome {
  status: "COMPLETED" | "FAILED" | "NOT_CONFIGURED";
  backupId?: string;
  backupCode?: string;
  message?: string;
}

export async function createDatabaseBackup(params: { trigger: "SCHEDULED" | "MANUAL"; actorId?: string | null }): Promise<BackupOutcome> {
  const keyMaterial = process.env.BACKUP_ENCRYPTION_KEY?.trim();
  if (!keyMaterial) return { status: "NOT_CONFIGURED", message: "BACKUP_ENCRYPTION_KEY is not configured — encrypted backups cannot be created." };
  const control = await getSystemControl();
  if (!control.backupsEnabled && params.trigger === "SCHEDULED") return { status: "NOT_CONFIGURED", message: "Backups are disabled in Backup Policy." };

  const startedAt = new Date();
  const run = await prisma.backupRun.create({
    data: {
      backupCode: await nextSequenceCode("BKP"),
      type: "DATABASE",
      trigger: params.trigger,
      status: "RUNNING",
      retentionClass: params.trigger === "MANUAL" ? "DAILY" : retentionClassFor(startedAt),
      triggeredById: params.actorId ?? null,
      separateStore: Boolean(process.env.BACKUP_BLOB_READ_WRITE_TOKEN) && !usingLocalSink(),
    },
  });
  await writeAudit({ action: "BACKUP_TRIGGERED", adminId: params.actorId ?? null, meta: { backupCode: run.backupCode, trigger: params.trigger, type: "DATABASE" } });

  try {
    const { encrypted, checksum, manifest, totalRows } = await buildBackupPayload(prisma, keyMaterial);
    const storageUrl = await storeBackupObject(`backups/db/${run.backupCode}.lppb`, encrypted);

    await prisma.backupRun.update({
      where: { id: run.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        sizeBytes: encrypted.length,
        checksumSha256: checksum,
        storageUrl,
        manifest: manifest as Prisma.InputJsonValue,
      },
    });
    logger.info("backup_completed", { backupCode: run.backupCode, sizeBytes: encrypted.length, totalRows });
    await pruneBackups().catch((e) => logger.warn("backup_prune_failed", { reason: e instanceof Error ? e.message : "unknown" }));
    return { status: "COMPLETED", backupId: run.id, backupCode: run.backupCode };
  } catch (error) {
    const reason = redactString(error instanceof Error ? error.message : String(error), 400);
    await prisma.backupRun.update({ where: { id: run.id }, data: { status: "FAILED", completedAt: new Date(), failureReason: reason } });
    logger.error("backup_failed", { backupCode: run.backupCode, reason });
    return { status: "FAILED", backupId: run.id, backupCode: run.backupCode, message: reason };
  }
}

// Applies the configured GFS retention and deletes the pruned ciphertext
// objects. The newest backup and newest verified backup are always kept.
export async function pruneBackups(): Promise<number> {
  const control = await getSystemControl();
  const runs = await prisma.backupRun.findMany({ where: { type: "DATABASE", status: "COMPLETED", prunedAt: null } });
  const ids = selectBackupsToPrune(
    runs.map((r) => ({ id: r.id, startedAt: r.startedAt, retentionClass: r.retentionClass, verified: r.verificationStatus === "PASSED" })),
    { dailyKeep: control.backupDailyKeep, weeklyKeep: control.backupWeeklyKeep, monthlyKeep: control.backupMonthlyKeep }
  );
  for (const id of ids) {
    const run = runs.find((r) => r.id === id)!;
    if (run.storageUrl) await deleteBackupObject(run.storageUrl);
    await prisma.backupRun.update({ where: { id }, data: { prunedAt: new Date(), storageUrl: null } });
  }
  return ids.length;
}
