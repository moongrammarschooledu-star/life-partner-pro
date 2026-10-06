import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { analyticsAudit } from "@/lib/analytics/audit";
import { getMetric, martMetrics } from "@/lib/analytics/metrics/registry";
import { versionNumber } from "@/lib/analytics/query-version";
import { activeEventsOf, getAnalyticsSettings } from "@/lib/analytics/settings";
import { addDaysKey, dayDate, dayKey, dayStartUtc, diffDays, eachDayKey, keyFromDbDate } from "@/lib/analytics/time";
import type { MetricComputeContext, MetricDefinition, MetricRange, SectionKey } from "@/lib/analytics/types";
import type { AnalyticsRunStatus } from "@prisma/client";

// STEP 31 — AnalyticsPipelineService. The data marts are DERIVED: every row can be deleted and rebuilt from the operational tables,
// which are never written. One generic fact table (AnalyticsDailyMetric) holds a row per (day, metric, version, dimension, value,
// currency); a "mart" is simply a named group of metrics (one per section) with its own freshness.
//
//   collectEvents / transformEvents  - nothing to copy: the existing event tables (EngagementEvent, MarketingEvent, ProposalEvent,
//                                      CrmLifecycleHistory, SubscriptionEvent, TaskStatusHistory, CaseStatusHistory) ARE the event layer.
//   buildDailyMetrics                - compute each additive metric for each day and upsert it (idempotent: re-running changes nothing).
//   buildCohorts / buildFunnels      - cohort-style figures change as people progress, so they are computed on demand (and cached), not stored.
//   refreshDataMarts                 - the daily job: catch up from the last covered day, within a time budget, resumable.
//   rebuildMetrics                   - delete a metric/mart range and recompute it from source.
//   validateMetrics                  - sanity checks on what was written.

export const DEFAULT_BACKFILL_DAYS = 30;
export const MAX_BACKFILL_DAYS = 120;
export const DEFAULT_BUDGET_MS = 25_000;

export function martKeyOf(section: SectionKey): string {
  return section;
}

export function martDefinitions(): Array<{ key: string; section: SectionKey; metrics: MetricDefinition[] }> {
  const bySection = new Map<SectionKey, MetricDefinition[]>();
  for (const m of martMetrics()) bySection.set(m.section, [...(bySection.get(m.section) ?? []), m]);
  return [...bySection.entries()].map(([section, metrics]) => ({ key: martKeyOf(section), section, metrics }));
}

function rangeFor(day: string, tz: string): MetricRange {
  return { fromDay: day, toDay: day, startUtc: dayStartUtc(day, tz), endUtc: dayStartUtc(addDaysKey(day, 1), tz) };
}

async function buildContext(): Promise<MetricComputeContext & { tenantId: string; minGroupSize: number }> {
  const s = await getAnalyticsSettings();
  return { tz: s.timezone, now: new Date(), activeEvents: activeEventsOf(s), tenantId: s.tenantId, minGroupSize: s.minGroupSize };
}

// Compute one metric for one day and write its rows (all dimensions). Returns the number of rows written.
export async function buildDailyMetric(def: MetricDefinition, day: string, ctx: MetricComputeContext & { tenantId: string }): Promise<number> {
  const compute = def.compute[def.computeVersion];
  if (!compute) throw new Error(`No implementation ${def.computeVersion} for ${def.key}`);
  const range = rangeFor(day, ctx.tz);
  const version = versionNumber(def);
  const date = dayDate(day);
  let written = 0;
  for (const dimension of ["ALL", ...def.dimensions]) {
    const rows = await compute(range, ctx, dimension);
    const data = rows.map((r) => ({
      date, metricKey: def.key, metricVersion: version, dimensionKey: dimension, dimensionValue: r.dimensionValue, currencyCode: r.currency, value: BigInt(Math.round(r.value)),
      denominator: r.denominator === null || r.denominator === undefined ? null : BigInt(Math.round(r.denominator)), tenantId: ctx.tenantId,
    }));
    // the undimensioned row always exists (zero when nothing happened) so coverage can be verified day by day
    if (dimension === "ALL" && data.length === 0) data.push({ date, metricKey: def.key, metricVersion: version, dimensionKey: "ALL", dimensionValue: "ALL", currencyCode: "", value: BigInt(0), denominator: def.isRate || def.isDuration ? BigInt(0) : null, tenantId: ctx.tenantId });
    await prisma.$transaction([
      prisma.analyticsDailyMetric.deleteMany({ where: { date, metricKey: def.key, metricVersion: version, dimensionKey: dimension, tenantId: ctx.tenantId } }),
      prisma.analyticsDailyMetric.createMany({ data, skipDuplicates: true }),
    ]);
    written += data.length;
  }
  return written;
}

export interface RefreshResult {
  runId: string;
  status: AnalyticsRunStatus;
  daysProcessed: number;
  metricsComputed: number;
  rowsWritten: number;
  errors: string[];
  partial: boolean;
}

async function finishRun(id: string, patch: { status: AnalyticsRunStatus; metricsComputed: number; rowsWritten: number; cursorDate?: string | null; error?: string | null }) {
  await prisma.analyticsRefreshRun.update({ where: { id }, data: { status: patch.status, metricsComputed: patch.metricsComputed, rowsWritten: patch.rowsWritten, cursorDate: patch.cursorDate ? dayDate(patch.cursorDate) : undefined, error: patch.error?.slice(0, 300) ?? null, finishedAt: new Date() } });
}

// The daily job: catch each mart up to today (re-doing the last two days, which can still receive late events), oldest day first,
// stopping when the time budget is used. The next tick/manual run continues from where it stopped.
export async function refreshDataMarts(opts: { now?: Date; budgetMs?: number; backfillDays?: number; triggeredBy?: string; martKey?: string } = {}): Promise<RefreshResult> {
  const started = Date.now();
  const budget = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  const ctx = await buildContext();
  if (opts.now) ctx.now = opts.now;
  const today = dayKey(ctx.now, ctx.tz);
  const backfill = Math.min(Math.max(opts.backfillDays ?? DEFAULT_BACKFILL_DAYS, 1), MAX_BACKFILL_DAYS);

  const run = await prisma.analyticsRefreshRun.create({ data: { kind: "DAILY", martKey: opts.martKey ?? null, rangeFrom: dayDate(addDaysKey(today, -backfill)), rangeTo: dayDate(today), triggeredBy: opts.triggeredBy ?? "cron" } });
  const errors: string[] = [];
  let metricsComputed = 0;
  let rowsWritten = 0;
  let daysProcessed = 0;
  let partial = false;

  for (const mart of martDefinitions().filter((m) => !opts.martKey || m.key === opts.martKey)) {
    const row = await prisma.analyticsMart.upsert({ where: { key: mart.key }, update: {}, create: { key: mart.key, name: `${mart.section} data mart`, metricKeys: mart.metrics.map((m) => m.key) as never, status: "RUNNING", tenantId: ctx.tenantId } });
    const covered = row.lastCoveredDate ? keyFromDbDate(row.lastCoveredDate) : null;
    const from = covered ? addDaysKey(covered, -1) : addDaysKey(today, -(backfill - 1));
    const days = eachDayKey(from < today ? from : today, today);
    let lastDone: string | null = null;
    let martFailed = false;
    for (const day of days) {
      if (Date.now() - started > budget) {
        partial = true;
        break;
      }
      for (const def of mart.metrics) {
        // snapshots describe "now": store them only for today
        if (def.kind === "SNAPSHOT" && day !== today) continue;
        try {
          rowsWritten += await buildDailyMetric(def, day, ctx);
          metricsComputed++;
        } catch (error) {
          martFailed = true;
          errors.push(`${def.key} ${day}: ${error instanceof Error ? error.message.slice(0, 120) : "failed"}`);
        }
      }
      lastDone = day;
      daysProcessed++;
    }
    await prisma.analyticsMart.update({
      where: { key: mart.key },
      data: { status: martFailed ? "FAILED" : partial ? "PARTIAL" : "SUCCEEDED", lastRefreshedAt: new Date(), lastCoveredDate: lastDone && !martFailed ? dayDate(lastDone) : row.lastCoveredDate, lastError: martFailed ? errors[errors.length - 1]?.slice(0, 300) : null },
    });
    if (partial) break;
  }

  const status: AnalyticsRunStatus = errors.length ? (metricsComputed > 0 ? "PARTIAL" : "FAILED") : partial ? "PARTIAL" : "SUCCEEDED";
  await finishRun(run.id, { status, metricsComputed, rowsWritten, error: errors[0] ?? null });
  await analyticsAudit({ action: "ANALYTICS_PIPELINE_RUN", actorId: opts.triggeredBy && opts.triggeredBy !== "cron" ? opts.triggeredBy : null, resource: "analytics_refresh", resourceId: run.id, after: { status, metricsComputed, rowsWritten, daysProcessed, partial } });
  return { runId: run.id, status, daysProcessed, metricsComputed, rowsWritten, errors: errors.slice(0, 10), partial };
}

// Rebuild a metric (or a whole mart) for a date range FROM SOURCE: the stored rows for that scope are deleted and recomputed.
export async function rebuildMetrics(actorId: string, scope: { metricKey?: string; martKey?: string; fromDay: string; toDay: string }, reason: string, opts: { budgetMs?: number; now?: Date } = {}): Promise<RefreshResult> {
  if (reason.trim().length < 3) throw new HttpError(422, "A reason is required.");
  if (!scope.metricKey && !scope.martKey) throw new HttpError(422, "Choose a metric or a mart to rebuild.");
  if (diffDays(scope.fromDay, scope.toDay) < 0 || diffDays(scope.fromDay, scope.toDay) + 1 > 400) throw new HttpError(422, "Choose a range of 1 to 400 days.");
  const defs: MetricDefinition[] = scope.metricKey
    ? [getMetric(scope.metricKey)].filter((m): m is MetricDefinition => !!m && !m.liveOnly)
    : (martDefinitions().find((m) => m.key === scope.martKey)?.metrics ?? []);
  if (!defs.length) throw new HttpError(404, "Nothing to rebuild for that scope (cohort metrics are never stored).");
  const started = Date.now();
  const budget = opts.budgetMs ?? 55_000;
  const ctx = await buildContext();
  if (opts.now) ctx.now = opts.now;
  const today = dayKey(ctx.now, ctx.tz);
  const run = await prisma.analyticsRefreshRun.create({ data: { kind: "REBUILD", martKey: scope.martKey ?? null, metricKey: scope.metricKey ?? null, rangeFrom: dayDate(scope.fromDay), rangeTo: dayDate(scope.toDay), triggeredBy: actorId } });
  const errors: string[] = [];
  let metricsComputed = 0;
  let rowsWritten = 0;
  let daysProcessed = 0;
  let partial = false;
  let cursor: string | null = null;
  for (const day of eachDayKey(scope.fromDay, scope.toDay)) {
    if (Date.now() - started > budget) { partial = true; break; }
    for (const def of defs) {
      if (def.kind === "SNAPSHOT" && day !== today) continue;
      try {
        rowsWritten += await buildDailyMetric(def, day, ctx);
        metricsComputed++;
      } catch (error) {
        errors.push(`${def.key} ${day}: ${error instanceof Error ? error.message.slice(0, 120) : "failed"}`);
      }
    }
    cursor = day;
    daysProcessed++;
  }
  const status: AnalyticsRunStatus = errors.length ? (metricsComputed > 0 ? "PARTIAL" : "FAILED") : partial ? "PARTIAL" : "SUCCEEDED";
  await finishRun(run.id, { status, metricsComputed, rowsWritten, cursorDate: cursor, error: errors[0] ?? null });
  await analyticsAudit({ action: "ANALYTICS_REBUILD", actorId, resource: scope.metricKey ? "metric" : "mart", resourceId: scope.metricKey ?? scope.martKey ?? "-", after: { from: scope.fromDay, to: scope.toDay, status, rowsWritten }, reason });
  return { runId: run.id, status, daysProcessed, metricsComputed, rowsWritten, errors: errors.slice(0, 10), partial };
}

export async function pipelineStatus() {
  const [marts, runs, rows, flag] = await Promise.all([
    prisma.analyticsMart.findMany({ orderBy: { key: "asc" } }),
    prisma.analyticsRefreshRun.findMany({ orderBy: { startedAt: "desc" }, take: 10 }),
    prisma.analyticsDailyMetric.count(),
    isFeatureEnabled("analytics.pipeline.enabled"),
  ]);
  return {
    enabled: flag, storedRows: rows,
    marts: marts.map((m) => ({ key: m.key, status: m.status, lastRefreshedAt: m.lastRefreshedAt, lastCoveredDate: m.lastCoveredDate ? keyFromDbDate(m.lastCoveredDate) : null, lastError: m.lastError })),
    runs: runs.map((r) => ({ id: r.id, kind: r.kind, status: r.status, startedAt: r.startedAt, finishedAt: r.finishedAt, metricsComputed: r.metricsComputed, rowsWritten: r.rowsWritten, error: r.error, triggeredBy: r.triggeredBy })),
  };
}

// The named methods from the specification, over the functions above.
export const AnalyticsPipelineService = {
  async collectEvents() { return { note: "Existing event tables are the event layer; nothing is copied." }; },
  async transformEvents() { return { note: "Transformation happens in each metric's versioned compute function." }; },
  buildDailyMetrics: async (days: string[], metricKeys?: string[]) => {
    const ctx = await buildContext();
    let rows = 0;
    for (const day of days) for (const def of martMetrics().filter((m) => !metricKeys || metricKeys.includes(m.key))) rows += await buildDailyMetric(def, day, ctx);
    return { rows };
  },
  async buildCohorts() { const { warmCohorts } = await import("@/lib/analytics/cohorts"); return warmCohorts(); },
  async buildFunnels() { const { warmFunnels } = await import("@/lib/analytics/cohorts"); return warmFunnels(); },
  refreshDataMarts,
  rebuildMetrics,
  async validateMetrics() { const { runDataQualityChecks } = await import("@/lib/analytics/data-quality"); return runDataQualityChecks(); },
};
