import { del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/observability/logger";
import { createDatabaseBackup } from "@/lib/backup/export";
import { mirrorFiles } from "@/lib/backup/files";
import { verifyBackup } from "@/lib/backup/verify";
import { runIntegrityChecks } from "@/lib/ops/integrity";
import { evaluateAndSyncAlerts } from "@/lib/ops/alerts";
import { cleanupRateLimitBuckets } from "@/lib/ops/rate-limit-persistent";
import { dispatchChannel } from "@/lib/notifications/dispatch";
import { encryptPhoto } from "@/lib/privacy/photo-crypto";
import { put } from "@vercel/blob";
import { randomUUID } from "crypto";
import type { BackgroundJob } from "@prisma/client";

// Handlers for the background job queue (see jobs.ts). A handler that throws
// is retried with backoff and eventually dead-lettered — so "no effect but
// success" outcomes (e.g. backups not configured) must return normally.

export async function backupDatabaseHandler(): Promise<void> {
  const outcome = await createDatabaseBackup({ trigger: "SCHEDULED" });
  if (outcome.status === "FAILED") throw new Error(outcome.message ?? "Database backup failed");
  if (outcome.status === "NOT_CONFIGURED") {
    logger.warn("backup_skipped", { reason: outcome.message });
    return;
  }
  // A backup is only trusted once its restore verification has passed.
  if (outcome.backupId) {
    const verification = await verifyBackup(outcome.backupId, null);
    if (!verification.passed) throw new Error("Backup was created but failed restore verification");
  }
}

export async function backupFilesHandler(): Promise<void> {
  const result = await mirrorFiles({ trigger: "SCHEDULED" });
  if (result.status === "FAILED") throw new Error("File backup failed");
}

export async function restoreVerifyHandler(job: BackgroundJob): Promise<void> {
  const backupId = (job.payload as { backupId?: string } | null)?.backupId;
  if (!backupId) throw new Error("restore-verify job has no backupId");
  const result = await verifyBackup(backupId, job.createdById);
  if (!result.passed) throw new Error("Restore verification failed");
}

export async function integrityCheckHandler(): Promise<void> {
  await runIntegrityChecks({ trigger: "SCHEDULED" });
}

export async function alertEvaluationHandler(): Promise<void> {
  await evaluateAndSyncAlerts();
}

export async function cleanupRateLimitsHandler(): Promise<void> {
  await cleanupRateLimitBuckets();
}

// Bounded automatic retry of failed notifications (STEP 9 made retry a manual
// action; STEP 15 §29 asks for queued retries). Still capped by the configured
// notificationRetryLimit, limited to the last 24 h and 20 messages per run.
export async function notificationRetryHandler(): Promise<void> {
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  const limit = settings?.notificationRetryLimit ?? 3;
  const failed = await prisma.communicationLog.findMany({
    where: { deliveryStatus: "FAILED", retryCount: { lt: limit }, createdAt: { gte: new Date(Date.now() - 24 * 3_600_000) } },
    include: { profile: { include: { contact: true } } },
    take: 20,
  });
  for (const log of failed) {
    const contact = log.profile.contact;
    const destination = log.channel === "EMAIL" ? contact?.email : log.channel === "WHATSAPP" ? contact?.whatsappNumber : contact?.mobileNumber;
    if (!destination) continue;
    await prisma.communicationLog.update({ where: { id: log.id }, data: { retryCount: { increment: 1 }, deliveryStatus: "QUEUED" } });
    await dispatchChannel(log.id, log.channel, destination, log.messageBody ?? "", undefined);
  }
}

// Photos uploaded before STEP 13 may still be stored unencrypted (null IV).
// Re-encrypts a bounded batch per run: fetch → AES-256-GCM → new blob →
// update the row → delete the old plaintext blob (only after the row points
// at the new one).
export async function encryptLegacyPhotosHandler(): Promise<void> {
  const legacy = await prisma.profilePhoto.findMany({ where: { OR: [{ ivBase64: null }, { authTagBase64: null }] }, take: 10 });
  for (const photo of legacy) {
    const res = await fetch(photo.storageKey);
    if (!res.ok) throw new Error(`Could not read legacy photo ${photo.id} (${res.status})`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const { ciphertext, ivBase64, authTagBase64 } = encryptPhoto(bytes);
    const blob = await put(`photos/${randomUUID()}.enc`, ciphertext, { access: "public", contentType: "application/octet-stream", addRandomSuffix: true });
    await prisma.profilePhoto.update({ where: { id: photo.id }, data: { storageKey: blob.url, ivBase64, authTagBase64 } });
    await del(photo.storageKey).catch(() => undefined);
  }
}

// Expired data-export blobs used to be marked EXPIRED in the DB but never
// deleted from storage (found in the STEP 15 audit). Deletes them now.
export async function cleanupExportBlobsHandler(): Promise<void> {
  const expired = await prisma.dataExportRequest.findMany({ where: { status: "EXPIRED", secureStorageReference: { not: null } }, take: 50 });
  for (const request of expired) {
    if (request.secureStorageReference) await del(request.secureStorageReference).catch(() => undefined);
    await prisma.dataExportRequest.update({ where: { id: request.id }, data: { secureStorageReference: null } });
  }
}
