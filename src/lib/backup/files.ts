import { createHash, randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { logger } from "@/lib/observability/logger";
import { redactString } from "@/lib/observability/redact";
import { storeBackupObject, usingLocalSink } from "@/lib/backup/storage";

// File backup (spec §6): an INCREMENTAL mirror of the encrypted blob objects
// (profile photos, verification documents, case evidence) into the backup
// storage account. Objects are copied exactly as stored — ciphertext — so the
// backup path never decrypts, previews or exposes any private file, and no
// admin interface can download them. Each run copies what is new within a
// time budget; the remainder is picked up by the next run.

const BUDGET_MS = 45_000;

async function listSources(): Promise<Array<{ url: string; kind: "PHOTO" | "DOCUMENT" | "EVIDENCE" }>> {
  const [photos, docs, evidence] = await Promise.all([
    prisma.profilePhoto.findMany({ select: { storageKey: true } }),
    prisma.verificationDocument.findMany({ select: { secureStorageReference: true } }),
    prisma.caseEvidence.findMany({ select: { secureStorageReference: true } }),
  ]);
  return [
    ...photos.map((p) => ({ url: p.storageKey, kind: "PHOTO" as const })),
    ...docs.map((d) => ({ url: d.secureStorageReference, kind: "DOCUMENT" as const })),
    ...evidence.map((e) => ({ url: e.secureStorageReference, kind: "EVIDENCE" as const })),
  ].filter((s) => /^https?:\/\//.test(s.url));
}

export async function mirrorFiles(params: { trigger: "SCHEDULED" | "MANUAL"; actorId?: string | null }) {
  const run = await prisma.backupRun.create({
    data: { backupCode: await nextSequenceCode("BKP"), type: "FILES", trigger: params.trigger, status: "RUNNING", triggeredById: params.actorId ?? null, separateStore: Boolean(process.env.BACKUP_BLOB_READ_WRITE_TOKEN) && !usingLocalSink() },
  });
  await writeAudit({ action: "BACKUP_TRIGGERED", adminId: params.actorId ?? null, meta: { backupCode: run.backupCode, trigger: params.trigger, type: "FILES" } });

  try {
    const sources = await listSources();
    const copied = new Set((await prisma.backupFileCopy.findMany({ select: { sourceUrl: true } })).map((c) => c.sourceUrl));
    const pending = sources.filter((s) => !copied.has(s.url));
    const deadline = Date.now() + BUDGET_MS;
    let copiedNow = 0;
    let bytes = 0;
    let failures = 0;

    for (const source of pending) {
      if (Date.now() > deadline) break;
      try {
        const res = await fetch(source.url);
        if (!res.ok) throw new Error(`source ${res.status}`);
        const data = Buffer.from(await res.arrayBuffer());
        const sha256 = createHash("sha256").update(data).digest("hex");
        const backupUrl = await storeBackupObject(`backups/files/${source.kind.toLowerCase()}/${randomUUID()}.bin`, data);
        await prisma.backupFileCopy.create({ data: { sourceUrl: source.url, backupUrl, sha256, sizeBytes: data.length, kind: source.kind } });
        copiedNow++;
        bytes += data.length;
      } catch {
        failures++;
      }
    }

    const remaining = pending.length - copiedNow;
    const status = failures > 0 && copiedNow === 0 && pending.length > 0 ? "FAILED" : "COMPLETED";
    await prisma.backupRun.update({
      where: { id: run.id },
      data: {
        status,
        completedAt: new Date(),
        sizeBytes: bytes,
        manifest: { totalSources: sources.length, alreadyMirrored: copied.size, copiedThisRun: copiedNow, remaining, failures },
        failureReason: status === "FAILED" ? `${failures} object(s) could not be copied` : null,
        verifiedAt: remaining === 0 && failures === 0 ? new Date() : null,
        verificationStatus: remaining === 0 && failures === 0 ? "PASSED" : null,
      },
    });
    logger.info("file_backup_finished", { backupCode: run.backupCode, copiedNow, remaining, failures });
    return { backupId: run.id, backupCode: run.backupCode, status, copiedNow, remaining, failures };
  } catch (error) {
    const reason = redactString(error instanceof Error ? error.message : String(error), 300);
    await prisma.backupRun.update({ where: { id: run.id }, data: { status: "FAILED", completedAt: new Date(), failureReason: reason } });
    return { backupId: run.id, backupCode: run.backupCode, status: "FAILED" as const, copiedNow: 0, remaining: 0, failures: 0 };
  }
}
