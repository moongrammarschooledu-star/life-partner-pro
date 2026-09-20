import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/observability/logger";
import { redactString } from "@/lib/observability/redact";
import { captureError } from "@/lib/observability/error-capture";

// Named, locked, recorded scheduled tasks (spec §31). The lock row prevents
// duplicate execution (e.g. a manual "Run now" overlapping the daily tick or
// two instances firing at once); every run is recorded with duration/status.

export interface CronRunResult<T> {
  name: string;
  status: "SUCCESS" | "FAILED" | "SKIPPED_LOCKED";
  durationMs: number;
  result?: T;
  error?: string;
}

export async function runCronTask<T>(name: string, fn: () => Promise<T>, opts: { lockMs?: number; schedule?: string; correlationId?: string } = {}): Promise<CronRunResult<T>> {
  const lockMs = opts.lockMs ?? 10 * 60_000;
  const now = new Date();

  await prisma.cronTask.upsert({ where: { name }, update: {}, create: { name, schedule: opts.schedule ?? null } });

  const acquired = await prisma.cronTask.updateMany({
    where: { name, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    data: { lockedUntil: new Date(now.getTime() + lockMs), lastStartedAt: now },
  });
  if (acquired.count === 0) {
    await prisma.cronTaskRun.create({ data: { taskName: name, status: "SKIPPED_LOCKED", completedAt: new Date(), durationMs: 0, correlationId: opts.correlationId ?? null } });
    return { name, status: "SKIPPED_LOCKED", durationMs: 0 };
  }

  const run = await prisma.cronTaskRun.create({ data: { taskName: name, status: "SUCCESS", startedAt: now, correlationId: opts.correlationId ?? null } });
  const started = Date.now();
  try {
    const result = await fn();
    const durationMs = Date.now() - started;
    await prisma.cronTaskRun.update({ where: { id: run.id }, data: { completedAt: new Date(), durationMs, status: "SUCCESS" } });
    await prisma.cronTask.update({ where: { name }, data: { lockedUntil: null, lastCompletedAt: new Date(), lastStatus: "SUCCESS", lastDurationMs: durationMs, consecutiveFailures: 0 } });
    return { name, status: "SUCCESS", durationMs, result };
  } catch (error) {
    const durationMs = Date.now() - started;
    const message = redactString(error instanceof Error ? error.message : String(error), 400);
    logger.error("cron_task_failed", { task: name, message, correlationId: opts.correlationId });
    await prisma.cronTaskRun.update({ where: { id: run.id }, data: { completedAt: new Date(), durationMs, status: "FAILED", error: message } });
    await prisma.cronTask.update({ where: { name }, data: { lockedUntil: null, lastCompletedAt: new Date(), lastStatus: "FAILED", lastDurationMs: durationMs, consecutiveFailures: { increment: 1 }, totalFailures: { increment: 1 } } });
    await captureError({ error, route: `cron:${name}`, service: "CRON", category: "SYSTEM_ERROR", severity: "HIGH", correlationId: opts.correlationId });
    return { name, status: "FAILED", durationMs, error: message };
  }
}
