import { prisma } from "@/lib/prisma";
import { runCronTask, type CronRunResult } from "@/lib/ops/cron";
import { enqueueJob, runDueJobs } from "@/lib/ops/jobs";
import { evaluateAndSyncAlerts } from "@/lib/ops/alerts";
import { runScheduledNotifications } from "@/lib/notifications/scheduled";
import { runDueScheduledReports } from "@/lib/reports/scheduler";
import { runDueRetentionActions } from "@/lib/privacy/retention-policy";
import { runDueSubscriptionRenewals } from "@/lib/finance/subscription";
import { runScheduledReconciliation } from "@/lib/finance/reconciliation";
import { runWorkflowAutomationSweep } from "@/lib/workflow/automation-sweep";

// The single daily tick (Vercel Hobby allows exactly one cron job). Every
// sub-task is isolated (one failing task no longer discards the others'
// results — the old Promise.all did), locked against duplicate execution,
// timed and recorded. New STEP 15 work is scheduled as deduplicated
// background jobs and executed by the worker at the end of the tick.

export const CRON_TASKS = [
  { name: "daily-tick", label: "Daily tick (parent of every task below)", schedule: "0 8 * * * (Vercel cron)" },
  { name: "notifications", label: "Scheduled notifications & reminders", schedule: "daily tick" },
  { name: "scheduled-reports", label: "Scheduled reports", schedule: "daily tick" },
  { name: "retention", label: "Retention / deletion sweep", schedule: "daily tick" },
  { name: "subscription-renewals", label: "Subscription renewals & grace periods", schedule: "daily tick" },
  { name: "payment-reconciliation", label: "Payment reconciliation (per configured frequency)", schedule: "daily tick" },
  { name: "workflow-automation", label: "Task SLA sweep, auto-escalation & automation retry", schedule: "daily tick" },
  { name: "enqueue-jobs", label: "Schedule daily background jobs", schedule: "daily tick" },
  { name: "job-worker", label: "Background job worker", schedule: "daily tick + manual" },
  { name: "alert-evaluation", label: "Monitoring alert evaluation", schedule: "daily tick" },
] as const;

async function enqueueDailyJobs(): Promise<number> {
  const day = new Date().toISOString().slice(0, 10);
  const jobs: Array<{ type: string; dedupKey: string }> = [
    { type: "BACKUP_DATABASE", dedupKey: `backup-db:${day}` },
    { type: "BACKUP_FILES", dedupKey: `backup-files:${day}` },
    { type: "INTEGRITY_CHECK", dedupKey: `integrity:${day}` },
    { type: "NOTIFICATION_RETRY", dedupKey: `notification-retry:${day}` },
    { type: "CLEANUP_RATE_LIMITS", dedupKey: `rate-limit-cleanup:${day}` },
    { type: "CLEANUP_EXPORT_BLOBS", dedupKey: `export-blob-cleanup:${day}` },
  ];
  const legacyPhotos = await prisma.profilePhoto.count({ where: { OR: [{ ivBase64: null }, { authTagBase64: null }] } });
  if (legacyPhotos > 0) jobs.push({ type: "ENCRYPT_LEGACY_PHOTOS", dedupKey: `legacy-photos:${day}` });
  for (const job of jobs) await enqueueJob(job);
  return jobs.length;
}

export async function runDailyTick(correlationId?: string) {
  const parent = await runCronTask(
    "daily-tick",
    async () => {
      const opts = { correlationId };
      const legacy: Array<CronRunResult<unknown>> = await Promise.all([
        runCronTask("notifications", runScheduledNotifications, opts),
        runCronTask("scheduled-reports", runDueScheduledReports, opts),
        runCronTask("retention", runDueRetentionActions, opts),
        runCronTask("subscription-renewals", runDueSubscriptionRenewals, opts),
        runCronTask("payment-reconciliation", runScheduledReconciliation, opts),
        runCronTask("workflow-automation", runWorkflowAutomationSweep, opts),
      ]);
      const enqueue = await runCronTask("enqueue-jobs", enqueueDailyJobs, opts);
      const worker = await runCronTask("job-worker", () => runDueJobs({ limit: 8, budgetMs: 30_000 }), opts);
      const alerts = await runCronTask("alert-evaluation", evaluateAndSyncAlerts, opts);

      const all = [...legacy, enqueue, worker, alerts];
      const failed = all.filter((r) => r.status === "FAILED").map((r) => r.name);
      if (failed.length) throw new Error(`Task(s) failed: ${failed.join(", ")}`);
      return { tasks: all.map((r) => ({ name: r.name, status: r.status, durationMs: r.durationMs })), legacy };
    },
    { lockMs: 15 * 60_000, schedule: "0 8 * * *", correlationId }
  );
  return parent;
}
