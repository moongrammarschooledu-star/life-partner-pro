import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { MIN_SAMPLE_SIZE, safeRate } from "@/lib/reports/sample-size";
import { dimensionAccessible, isSensitiveMetric, metricAccessible, suppressSmallGroups, type Viewer } from "@/lib/analytics/access";
import { logAnalyticsAccess } from "@/lib/analytics/audit";
import { getMetric } from "@/lib/analytics/metrics/registry";
import { isMetricBlocked } from "@/lib/analytics/catalog-service";
import { versionNumber } from "@/lib/analytics/query-version";
import { activeEventsOf, getAnalyticsSettings } from "@/lib/analytics/settings";
import { COMPARE_MODES, PERIOD_PRESETS, dayDate, eachDayKey, keyFromDbDate, percentChange, resolveComparison, resolvePeriod, type CompareMode, type Period, type PeriodPreset } from "@/lib/analytics/time";
import type { Freshness, MetricComputeContext, MetricDefinition, MetricRange, MetricResult, MetricRow, MetricValueRow } from "@/lib/analytics/types";

// STEP 31 — THE query engine. Dashboards, saved reports, drill-downs, KPIs and the AI assistant all go through runAnalyticsQuery:
//   validate (closed schema) → metric exists → permission → dimension allowed → period/comparison → read (mart, or live) → derive
//   (rates/durations) → small-group suppression → result with definition, version and freshness.
// Nothing here accepts SQL or a column name: a query names catalog metrics and allow-listed dimensions only.

export const MAX_LIVE_DAYS = 400;
export const querySchema = z.object({
  metrics: z.array(z.string().min(1).max(80)).min(1).max(16),
  period: z.object({ preset: z.enum(PERIOD_PRESETS as [PeriodPreset, ...PeriodPreset[]]), from: z.string().max(10).optional(), to: z.string().max(10).optional() }).strict(),
  compare: z.enum(COMPARE_MODES as [CompareMode, ...CompareMode[]]).optional(),
  dimension: z.string().max(40).optional(),
}).strict();
export type AnalyticsQuery = z.infer<typeof querySchema>;

export interface QueryResult {
  period: Period;
  comparison: Period | null;
  results: MetricResult[];
  freshness: Freshness;
  dimension: string;
}

// ---- small in-memory cache for LIVE reads (snapshots / cohorts), so a dashboard refresh never re-runs heavy counts ----
const liveCache = new Map<string, { at: number; rows: MetricRow[] }>();
const LIVE_TTL_MS = 60_000;
export function clearAnalyticsCache(): void {
  liveCache.clear();
}

async function computeLive(def: MetricDefinition, range: MetricRange, ctx: MetricComputeContext, dimension: string, version = def.computeVersion): Promise<MetricRow[]> {
  const fn = def.compute[version];
  if (!fn) throw new HttpError(500, `Metric ${def.key} has no implementation ${version}.`);
  const key = `${def.key}|${version}|${range.fromDay}|${range.toDay}|${dimension}|${ctx.tz}`;
  const hit = liveCache.get(key);
  if (hit && Date.now() - hit.at < LIVE_TTL_MS) return hit.rows;
  const rows = await fn(range, ctx, dimension);
  liveCache.set(key, { at: Date.now(), rows });
  if (liveCache.size > 500) liveCache.delete(liveCache.keys().next().value as string);
  return rows;
}

export const rangeOf = (p: Period): MetricRange => ({ fromDay: p.fromDay, toDay: p.toDay, startUtc: p.startUtc, endUtc: p.endUtc });

interface MartRead { rows: MetricRow[]; covered: boolean; computedAt: Date | null }

async function readMart(def: MetricDefinition, p: Period, dimension: string, tenantId = ""): Promise<MartRead> {
  const where = { metricKey: def.key, metricVersion: versionNumber(def), date: { gte: dayDate(p.fromDay), lte: dayDate(p.toDay) }, tenantId };
  // coverage: every day in the range has an undimensioned row
  const days = await prisma.analyticsDailyMetric.findMany({ where: { ...where, dimensionKey: "ALL" }, select: { date: true }, distinct: ["date"] });
  const have = new Set(days.map((d) => keyFromDbDate(d.date)));
  const covered = eachDayKey(p.fromDay, p.toDay).every((k) => have.has(k));
  if (!covered) return { rows: [], covered: false, computedAt: null };
  const grouped = await prisma.analyticsDailyMetric.groupBy({
    by: ["dimensionValue", "currencyCode"],
    where: { ...where, dimensionKey: dimension === "ALL" ? "ALL" : dimension },
    _sum: { value: true, denominator: true }, _max: { computedAt: true },
  });
  const latest = grouped.reduce<Date | null>((acc, g) => (g._max.computedAt && (!acc || g._max.computedAt > acc) ? g._max.computedAt : acc), null);
  return { rows: grouped.map((g) => ({ dimensionValue: g.dimensionValue, currency: g.currencyCode, value: Number(g._sum.value ?? 0), denominator: g._sum.denominator === null ? null : Number(g._sum.denominator) })), covered: true, computedAt: latest };
}

export { versionNumber };

// ---- derivation: what a person reads ----
export function toDisplay(def: Pick<MetricDefinition, "unit" | "isRate" | "isDuration">, row: MetricRow): MetricValueRow {
  const base = { dimensionValue: row.dimensionValue, currency: row.currency, value: row.value, denominator: row.denominator ?? null };
  if (def.isRate) {
    const rate = row.denominator === null || row.denominator === undefined ? null : safeRate(row.value, row.denominator);
    return { ...base, display: rate };
  }
  if (def.isDuration) {
    const d = row.denominator ?? 0;
    return { ...base, display: d > 0 ? Math.round((row.value / d / 60) * 10) / 10 : null };
  }
  return { ...base, display: row.value };
}

const key = (r: { dimensionValue: string; currency: string }) => `${r.dimensionValue}|${r.currency}`;

async function valuesFor(def: MetricDefinition, period: Period, dimension: string, ctx: MetricComputeContext, tenantId: string): Promise<{ rows: MetricRow[]; mode: "DAILY_MART" | "LIVE"; computedAt: Date | null }> {
  const range = rangeOf(period);
  if (def.kind === "SNAPSHOT") {
    // "as of now" for a period that includes today, otherwise the value stored for the period's last day (null when never stored)
    const includesToday = period.endUtc.getTime() > ctx.now.getTime();
    if (includesToday) return { rows: await computeLive(def, range, ctx, dimension), mode: "LIVE", computedAt: ctx.now };
    const stored = await prisma.analyticsDailyMetric.groupBy({
      by: ["dimensionValue", "currencyCode"], where: { metricKey: def.key, metricVersion: versionNumber(def), date: dayDate(period.toDay), tenantId, dimensionKey: dimension === "ALL" ? "ALL" : dimension }, _sum: { value: true },
    });
    return { rows: stored.map((g) => ({ dimensionValue: g.dimensionValue, currency: g.currencyCode, value: Number(g._sum.value ?? 0), denominator: null })), mode: "DAILY_MART", computedAt: null };
  }
  if (!def.liveOnly) {
    const mart = await readMart(def, period, dimension, tenantId);
    if (mart.covered) return { rows: mart.rows, mode: "DAILY_MART", computedAt: mart.computedAt };
  }
  if (period.days > MAX_LIVE_DAYS) throw new HttpError(422, `This range is too long to calculate live (max ${MAX_LIVE_DAYS} days); refresh the data marts or choose a shorter range.`);
  return { rows: await computeLive(def, range, ctx, dimension), mode: "LIVE", computedAt: ctx.now };
}

function pad(rows: MetricRow[], def: MetricDefinition, dimension: string): MetricRow[] {
  // a total with no rows (e.g. a money metric with no payments) is shown as 0 rather than missing
  if (rows.length === 0 && dimension === "ALL") return [{ dimensionValue: "ALL", currency: def.unit === "MINOR_MONEY" ? "" : "", value: 0, denominator: def.isRate || def.isDuration ? 0 : null }];
  return rows;
}

export async function runAnalyticsQuery(viewer: Viewer, input: unknown, opts: { now?: Date; resource?: string; skipAccessLog?: boolean } = {}): Promise<QueryResult> {
  const parsed = querySchema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, "Invalid analytics query.");
  const q = parsed.data;
  const dimension = q.dimension ?? "ALL";
  const now = opts.now ?? new Date();
  const settings = await getAnalyticsSettings();
  const tz = settings.timezone;

  const defs: MetricDefinition[] = [];
  for (const k of [...new Set(q.metrics)]) {
    const def = getMetric(k);
    if (!def) throw new HttpError(400, `Unknown metric: ${k.slice(0, 60)}`);
    if (!metricAccessible(viewer, def)) {
      await logAnalyticsAccess({ adminId: viewer.id, action: "DENIED", resource: "metric", resourceId: def.key, outcome: "DENIED", sensitive: isSensitiveMetric(def) });
      throw new HttpError(403, "You do not have access to one of these metrics.");
    }
    if (await isMetricBlocked(def.key)) throw new HttpError(409, `${def.name} is suspended or retired and cannot be used.`);
    if (dimension !== "ALL" && !dimensionAccessible(viewer, def, dimension)) throw new HttpError(400, `${def.name} cannot be broken down by ${dimension.slice(0, 30)}.`);
    defs.push(def);
  }

  let period: Period;
  try {
    period = resolvePeriod(q.period.preset, tz, now, { from: q.period.from, to: q.period.to });
  } catch (error) {
    throw new HttpError(422, error instanceof Error ? error.message : "Invalid period.");
  }
  const comparison = q.compare && q.compare !== "NONE" ? resolveComparison(period, q.compare, tz) : null;
  const ctx: MetricComputeContext = { tz, now, activeEvents: activeEventsOf(settings) };

  const results: MetricResult[] = [];
  const modes = new Set<string>();
  let latest: Date | null = null;
  for (const def of defs) {
    const cur = await valuesFor(def, period, dimension, ctx, settings.tenantId);
    modes.add(cur.mode);
    if (cur.computedAt && (!latest || cur.computedAt > latest)) latest = cur.computedAt;
    const rows = pad(cur.rows, def, dimension);
    const shown = dimension === "ALL" ? rows.map((r) => ({ ...r, suppressed: false })) : suppressSmallGroups(rows, settings.minGroupSize);
    const values = shown.map((r) => (r.suppressed ? { dimensionValue: r.dimensionValue, currency: r.currency, value: null, denominator: null, display: null, suppressed: true } : toDisplay(def, r)));

    let previous: MetricValueRow[] | undefined;
    let changePct: Record<string, number | null> | undefined;
    if (comparison) {
      const prev = await valuesFor(def, comparison, dimension, ctx, settings.tenantId).catch(() => null);
      if (prev) {
        const prevShown = dimension === "ALL" ? pad(prev.rows, def, dimension) : prev.rows;
        previous = prevShown.map((r) => toDisplay(def, r));
        changePct = {};
        for (const v of values) {
          const p = previous.find((x) => key(x) === key(v));
          changePct[key(v)] = v.suppressed ? null : percentChange(v.display, p?.display ?? null);
        }
      }
    }
    const insufficient = def.isRate ? values.every((v) => v.display === null) : false;
    results.push({
      key: def.key, name: def.name, unit: def.unit, kind: def.kind, version: def.computeVersion, section: def.section,
      definition: { formula: def.formula, source: def.source, filters: def.filters, exclusions: def.exclusions, owner: def.owner, note: def.note },
      values, previous, changePct, insufficient, note: def.note,
    });
  }

  const mode: Freshness["mode"] = modes.size > 1 ? "MIXED" : modes.has("DAILY_MART") ? "DAILY_MART" : "LIVE";
  const freshness = await buildFreshness(mode, latest, period, now, settings.freshnessSlaHours, defs);
  if (!opts.skipAccessLog) await logAnalyticsAccess({ adminId: viewer.id, action: "QUERY", resource: opts.resource ?? "analytics_query", resourceId: defs.map((d) => d.key).slice(0, 4).join(","), sensitive: defs.some(isSensitiveMetric) });
  return { period, comparison, results, freshness, dimension };
}

async function buildFreshness(mode: Freshness["mode"], latest: Date | null, period: Period, now: Date, slaHours: number, defs: MetricDefinition[]): Promise<Freshness> {
  const martBacked = defs.some((d) => d.kind === "PERIOD" && !d.liveOnly);
  let refreshStatus: Freshness["refreshStatus"] = "NOT_APPLICABLE";
  let updatedAt: Date | null = mode === "LIVE" ? now : latest;
  if (martBacked) {
    const mart = await prisma.analyticsMart.findFirst({ orderBy: { lastRefreshedAt: "desc" }, select: { lastRefreshedAt: true, status: true } });
    if (!mart || !mart.lastRefreshedAt) refreshStatus = "NEVER_REFRESHED";
    else if (mart.status === "FAILED") refreshStatus = "FAILED";
    else refreshStatus = now.getTime() - mart.lastRefreshedAt.getTime() > slaHours * 3_600_000 ? "STALE" : "OK";
    if (mode !== "LIVE") updatedAt = mart?.lastRefreshedAt ?? latest;
  }
  const when = updatedAt ? updatedAt.toISOString().replace("T", " ").slice(0, 16) + " UTC" : "not yet";
  const label = mode === "LIVE" ? `Calculated live at ${when}` : mode === "DAILY_MART" ? `Daily metrics — updated ${when}` : `Mixed: daily metrics updated ${when}; other figures calculated live`;
  return { mode, updatedAt: updatedAt ? updatedAt.toISOString() : null, period: period.label, source: "Life Partner Pro operational data", refreshStatus, label };
}

export { MIN_SAMPLE_SIZE };

// Permission-free read for SYSTEM jobs only (alert evaluation, forecasts, reconciliation). It never serves a person: callers must not
// pass its output to a user without their own access check.
export async function systemMetricValue(key: string, fromDay: string, toDay: string, now: Date = new Date()): Promise<{ value: number | null; denominator: number | null; display: number | null; currency: string } | null> {
  const def = getMetric(key);
  if (!def) return null;
  const settings = await getAnalyticsSettings();
  const period = resolvePeriod("CUSTOM", settings.timezone, now, { from: fromDay, to: toDay });
  const ctx: MetricComputeContext = { tz: settings.timezone, now, activeEvents: activeEventsOf(settings) };
  const read = await valuesFor(def, period, "ALL", ctx, settings.tenantId);
  const rows = pad(read.rows, def, "ALL");
  const row = rows[0];
  if (!row) return null;
  const shown = toDisplay(def, row);
  return { value: shown.value, denominator: shown.denominator, display: shown.display, currency: shown.currency };
}
