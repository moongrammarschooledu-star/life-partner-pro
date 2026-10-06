import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { evaluateAlertRules } from "@/lib/analytics/alerts";
import { runDataQualityChecks } from "@/lib/analytics/data-quality";
import { refreshDataMarts } from "@/lib/analytics/pipeline";
import { runReconciliation } from "@/lib/analytics/reconciliation";
import { runDueSchedules } from "@/lib/analytics/report-scheduler";

// STEP 31 - the analytics part of the single daily tick (also callable from the admin "Run now"). Order matters:
// refresh marts -> check data quality -> reconcile -> evaluate alerts -> deliver due scheduled reports. Each step is isolated; nothing
// here writes to an operational table, and every step is a no-op when its flag is off.

export interface AnalyticsTickResult {
  skipped: boolean;
  pipeline: Awaited<ReturnType<typeof refreshDataMarts>> | null;
  dataQuality: Awaited<ReturnType<typeof runDataQualityChecks>> | null;
  reconciliation: { reconciled: number; variances: number } | null;
  alerts: Awaited<ReturnType<typeof evaluateAlertRules>> | null;
  schedules: Awaited<ReturnType<typeof runDueSchedules>> | null;
  errors: string[];
}

async function step<T>(name: string, errors: string[], fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    errors.push(`${name}: ${error instanceof Error ? error.message.slice(0, 160) : "failed"}`);
    return null;
  }
}

export async function runAnalyticsTick(opts: { now?: Date; triggeredBy?: string } = {}): Promise<AnalyticsTickResult> {
  const errors: string[] = [];
  if (!(await isFeatureEnabled("analytics.enabled"))) return { skipped: true, pipeline: null, dataQuality: null, reconciliation: null, alerts: null, schedules: null, errors };
  const pipelineOn = await isFeatureEnabled("analytics.pipeline.enabled");
  const pipeline = pipelineOn ? await step("pipeline", errors, () => refreshDataMarts({ now: opts.now, triggeredBy: opts.triggeredBy })) : null;
  const dataQuality = pipelineOn ? await step("data-quality", errors, () => runDataQualityChecks(opts.now)) : null;
  const rec = pipelineOn ? await step("reconciliation", errors, () => runReconciliation(opts.triggeredBy && opts.triggeredBy !== "cron" ? opts.triggeredBy : null, { now: opts.now })) : null;
  const alerts = await step("alerts", errors, () => evaluateAlertRules(opts.now));
  const schedules = await step("schedules", errors, () => runDueSchedules(opts.now));
  return { skipped: false, pipeline, dataQuality, reconciliation: rec ? { reconciled: rec.reconciled, variances: rec.variances } : null, alerts, schedules, errors };
}
