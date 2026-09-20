import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/observability/logger";
import { redactString } from "@/lib/observability/redact";
import { captureError } from "@/lib/observability/error-capture";
import { getCorrelationId } from "@/lib/observability/correlation";
import { nextStatusAfterFailure, canRetry, canCancel } from "@/lib/ops/job-policy";
import type { BackgroundJob, Prisma } from "@prisma/client";

// DB-backed job queue (spec §29/§30). Honest limits: Vercel Hobby has one
// daily cron and no long-running workers, so jobs are picked up by the daily
// tick, by an admin "Run now", or opportunistically — this is reliable
// deferred/retried processing with dedup and audit, not a real-time queue.

export type JobHandler = (job: BackgroundJob) => Promise<void>;

const HANDLER_LOADERS: Record<string, () => Promise<JobHandler>> = {
  BACKUP_DATABASE: async () => (await import("@/lib/ops/job-handlers")).backupDatabaseHandler,
  BACKUP_FILES: async () => (await import("@/lib/ops/job-handlers")).backupFilesHandler,
  RESTORE_VERIFY: async () => (await import("@/lib/ops/job-handlers")).restoreVerifyHandler,
  INTEGRITY_CHECK: async () => (await import("@/lib/ops/job-handlers")).integrityCheckHandler,
  ALERT_EVALUATION: async () => (await import("@/lib/ops/job-handlers")).alertEvaluationHandler,
  NOTIFICATION_RETRY: async () => (await import("@/lib/ops/job-handlers")).notificationRetryHandler,
  ENCRYPT_LEGACY_PHOTOS: async () => (await import("@/lib/ops/job-handlers")).encryptLegacyPhotosHandler,
  CLEANUP_EXPORT_BLOBS: async () => (await import("@/lib/ops/job-handlers")).cleanupExportBlobsHandler,
  CLEANUP_RATE_LIMITS: async () => (await import("@/lib/ops/job-handlers")).cleanupRateLimitsHandler,
};

export const JOB_TYPES = Object.keys(HANDLER_LOADERS);

export async function enqueueJob(params: {
  type: string;
  dedupKey?: string;
  payload?: Prisma.InputJsonValue;
  runAfter?: Date;
  maxAttempts?: number;
  createdById?: string | null;
}): Promise<BackgroundJob> {
  if (!(params.type in HANDLER_LOADERS)) throw new Error(`Unknown job type: ${params.type}`);
  if (params.dedupKey) {
    const existing = await prisma.backgroundJob.findUnique({ where: { dedupKey: params.dedupKey } });
    if (existing) return existing; // duplicate enqueue is a no-op (spec §29: prevent duplicate processing)
  }
  try {
    return await prisma.backgroundJob.create({
      data: {
        type: params.type,
        dedupKey: params.dedupKey ?? null,
        payload: params.payload,
        runAfter: params.runAfter ?? new Date(),
        maxAttempts: params.maxAttempts ?? 3,
        createdById: params.createdById ?? null,
        correlationId: (await getCorrelationId()) ?? null,
      },
    });
  } catch (error) {
    // Lost a race on the unique dedupKey — return the winner.
    if (params.dedupKey) {
      const winner = await prisma.backgroundJob.findUnique({ where: { dedupKey: params.dedupKey } });
      if (winner) return winner;
    }
    throw error;
  }
}

async function recoverStuckJobs(): Promise<void> {
  // A RUNNING job whose lock expired belongs to a crashed/timed-out invocation.
  const stuck = await prisma.backgroundJob.findMany({ where: { status: "RUNNING", lockedUntil: { lt: new Date() } } });
  for (const job of stuck) {
    const { status, delayMs } = nextStatusAfterFailure(job.attempts, job.maxAttempts);
    await prisma.backgroundJob.updateMany({
      where: { id: job.id, status: "RUNNING" },
      data: { status, lockedUntil: null, failureReason: "Worker did not finish (timed out or crashed)", runAfter: delayMs ? new Date(Date.now() + delayMs) : undefined },
    });
  }
}

// Atomic claim: only the invocation whose updateMany flips the row wins, so a
// job can never be processed twice concurrently.
async function claim(id: string): Promise<boolean> {
  const result = await prisma.backgroundJob.updateMany({
    where: { id, status: { in: ["PENDING", "RETRYING"] } },
    data: { status: "RUNNING", startedAt: new Date(), lockedUntil: new Date(Date.now() + 5 * 60_000), attempts: { increment: 1 } },
  });
  return result.count === 1;
}

export async function runDueJobs(opts: { limit?: number; budgetMs?: number } = {}): Promise<{ processed: number; succeeded: number; failed: number }> {
  const limit = opts.limit ?? 5;
  const deadline = Date.now() + (opts.budgetMs ?? 25_000);
  await recoverStuckJobs();

  const due = await prisma.backgroundJob.findMany({
    where: { status: { in: ["PENDING", "RETRYING"] }, runAfter: { lte: new Date() } },
    orderBy: { runAfter: "asc" },
    take: limit,
  });

  let succeeded = 0;
  let failed = 0;
  let processed = 0;
  for (const candidate of due) {
    if (Date.now() > deadline) break;
    if (!(await claim(candidate.id))) continue;
    processed++;
    const job = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: candidate.id } });
    try {
      const handler = await HANDLER_LOADERS[job.type]();
      await handler(job);
      await prisma.backgroundJob.update({ where: { id: job.id }, data: { status: "COMPLETED", completedAt: new Date(), lockedUntil: null, failureReason: null } });
      succeeded++;
    } catch (error) {
      failed++;
      const reason = redactString(error instanceof Error ? error.message : String(error), 400);
      const { status, delayMs } = nextStatusAfterFailure(job.attempts, job.maxAttempts);
      await prisma.backgroundJob.update({ where: { id: job.id }, data: { status, lockedUntil: null, failureReason: reason, runAfter: delayMs ? new Date(Date.now() + delayMs) : undefined } });
      logger.error("job_failed", { jobId: job.id, type: job.type, attempts: job.attempts, status, correlationId: job.correlationId ?? undefined });
      await captureError({ error, route: `job:${job.type}`, service: "JOB", category: "SYSTEM_ERROR", severity: status === "DEAD_LETTER" ? "HIGH" : "MEDIUM", correlationId: job.correlationId ?? undefined });
    }
  }
  return { processed, succeeded, failed };
}

// ---- Manual interventions (spec §30) — every one is audited ---------------

export async function retryJob(jobId: string, adminId: string): Promise<void> {
  const job = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: jobId } });
  if (!canRetry(job.status)) throw new Error(`A ${job.status} job cannot be retried.`);
  await prisma.backgroundJob.update({ where: { id: jobId }, data: { status: "PENDING", runAfter: new Date(), maxAttempts: Math.max(job.maxAttempts, job.attempts + 1), failureReason: null, resolved: false } });
  await writeAudit({ action: "JOB_INTERVENTION", adminId, meta: { jobId, type: job.type, action: "RETRY" } });
}

export async function cancelJob(jobId: string, adminId: string): Promise<void> {
  const job = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: jobId } });
  if (!canCancel(job.status)) throw new Error(`A ${job.status} job cannot be cancelled.`);
  await prisma.backgroundJob.update({ where: { id: jobId }, data: { status: "CANCELLED", completedAt: new Date() } });
  await writeAudit({ action: "JOB_INTERVENTION", adminId, meta: { jobId, type: job.type, action: "CANCEL" } });
}

export async function resolveJob(jobId: string, adminId: string): Promise<void> {
  const job = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: jobId } });
  await prisma.backgroundJob.update({ where: { id: jobId }, data: { resolved: true, resolvedById: adminId } });
  await writeAudit({ action: "JOB_INTERVENTION", adminId, meta: { jobId, type: job.type, action: "RESOLVE" } });
}
