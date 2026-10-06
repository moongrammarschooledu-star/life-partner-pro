import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { analyticsAudit } from "@/lib/analytics/audit";
import { metricAccessible, type Viewer } from "@/lib/analytics/access";
import { getMetric } from "@/lib/analytics/metrics/registry";
import { versionNumber } from "@/lib/analytics/query-version";
import { getAnalyticsSettings } from "@/lib/analytics/settings";
import { addDaysKey, dayDate, dayKey, keyFromDbDate } from "@/lib/analytics/time";

// STEP 31 — forecasting support. A transparent statistical ESTIMATE of an aggregate daily series (registrations, leads, support cases,
// renewals, revenue per currency). Model: ordinary least-squares line through the last N daily values; the interval is ±1.96 × the
// residual standard deviation (an approximate 95% band). It is never about a person, never a prediction of any marriage or response,
// and is withheld ("Insufficient verified data") when there is too little history or the history is mostly empty.

export const FORECASTABLE = ["applicants.new", "funnel.leads", "support.opened", "membership.renewals_completed", "finance.gross_revenue"] as const;
export const MIN_HISTORY_DAYS = 28;
export const MAX_HORIZON_DAYS = 90;
export const MODEL = "Linear trend (least squares) with a ±1.96σ residual band";

export interface ForecastPoint { day: string; estimate: number; low: number; high: number }
export interface ForecastResult {
  ok: boolean;
  metricKey: string;
  currency: string;
  message?: string;
  model?: string;
  historyFrom?: string;
  historyTo?: string;
  historyDays?: number;
  horizonDays?: number;
  points?: ForecastPoint[];
  assumptions?: string[];
  limitations?: string[];
}

// pure: fit y = a + b·x and return the band; days with no data are zero (the series is a daily total)
export function fitLinear(values: number[]): { a: number; b: number; sigma: number } {
  const n = values.length;
  const xs = values.map((_, i) => i);
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = values.reduce((s, y) => s + y, 0) / n;
  const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  const sxy = xs.reduce((s, x, i) => s + (x - mx) * (values[i] - my), 0);
  const b = sxx === 0 ? 0 : sxy / sxx;
  const a = my - b * mx;
  const sse = values.reduce((s, y, i) => s + (y - (a + b * i)) ** 2, 0);
  const sigma = n > 2 ? Math.sqrt(sse / (n - 2)) : 0;
  return { a, b, sigma };
}

export function buildForecast(history: number[], horizon: number, lastDay: string): { points: ForecastPoint[]; sigma: number; slope: number } {
  const { a, b, sigma } = fitLinear(history);
  const points: ForecastPoint[] = [];
  for (let h = 1; h <= horizon; h++) {
    const est = a + b * (history.length - 1 + h);
    // counts and amounts cannot be negative; the band keeps the same floor
    points.push({ day: addDaysKey(lastDay, h), estimate: Math.max(0, Math.round(est)), low: Math.max(0, Math.round(est - 1.96 * sigma)), high: Math.max(0, Math.round(est + 1.96 * sigma)) });
  }
  return { points, sigma, slope: b };
}

export async function generateForecast(viewer: Viewer, metricKey: string, opts: { horizonDays?: number; historyDays?: number; currency?: string; now?: Date; store?: boolean } = {}): Promise<ForecastResult> {
  const currency = opts.currency ?? "";
  const base: ForecastResult = { ok: false, metricKey, currency };
  if (!(await isFeatureEnabled("analytics.forecast.enabled"))) return { ...base, message: "Forecasts are switched off." };
  if (!(FORECASTABLE as readonly string[]).includes(metricKey)) throw new HttpError(422, "That metric cannot be forecast.");
  const def = getMetric(metricKey)!;
  if (!viewer.permissions.includes("analytics:forecast:view") || !metricAccessible(viewer, def)) throw new HttpError(403, "You do not have access to this forecast.");
  const settings = await getAnalyticsSettings();
  const now = opts.now ?? new Date();
  const horizon = Math.min(Math.max(Math.trunc(opts.horizonDays ?? 30), 1), MAX_HORIZON_DAYS);
  const historyDays = Math.min(Math.max(Math.trunc(opts.historyDays ?? 90), MIN_HISTORY_DAYS), 365);
  const toDay = addDaysKey(dayKey(now, settings.timezone), -1);
  const fromDay = addDaysKey(toDay, -(historyDays - 1));

  const rows = await prisma.analyticsDailyMetric.groupBy({
    by: ["date"], where: { metricKey, metricVersion: versionNumber(def), dimensionKey: "ALL", currencyCode: currency, tenantId: settings.tenantId, date: { gte: dayDate(fromDay), lte: dayDate(toDay) } }, _sum: { value: true },
  });
  const covered = await prisma.analyticsDailyMetric.findMany({ where: { metricKey, metricVersion: versionNumber(def), dimensionKey: "ALL", tenantId: settings.tenantId, date: { gte: dayDate(fromDay), lte: dayDate(toDay) } }, select: { date: true }, distinct: ["date"] });
  const byDay = new Map(rows.map((r) => [keyFromDbDate(r.date), Number(r._sum.value ?? 0)]));
  const history: number[] = [];
  for (let k = fromDay; k <= toDay; k = addDaysKey(k, 1)) history.push(byDay.get(k) ?? 0);
  if (covered.length < MIN_HISTORY_DAYS) return { ...base, message: `Insufficient verified data: the daily data mart covers ${covered.length} of the last ${historyDays} days and at least ${MIN_HISTORY_DAYS} are needed.` };
  if (history.filter((v) => v > 0).length < 7) return { ...base, message: "Insufficient verified data: too few days with activity to estimate a trend." };

  const { points, sigma } = buildForecast(history, horizon, toDay);
  const result: ForecastResult = {
    ok: true, metricKey, currency, model: MODEL, historyFrom: fromDay, historyTo: toDay, historyDays: history.length, horizonDays: horizon, points,
    assumptions: ["The recent trend continues in a straight line.", "No seasonality, campaigns, holidays or pricing changes are modelled.", `The band is ±1.96 × the typical day-to-day deviation (${Math.round(sigma * 100) / 100}) and is approximate.`],
    limitations: ["This is an estimate of an aggregate daily total, not a promise and not a target.", "It says nothing about any individual applicant, response or outcome.", "Treat the band, not the middle line, as the honest range."],
  };
  if (opts.store !== false) {
    await prisma.analyticsForecast.create({ data: { metricKey, currencyCode: currency, model: MODEL, historyFrom: dayDate(fromDay), historyTo: dayDate(toDay), horizonDays: horizon, points: points as never, assumptions: result.assumptions as never, limitations: result.limitations as never, generatedById: viewer.id } });
    await analyticsAudit({ action: "ANALYTICS_FORECAST_GENERATED", actorId: viewer.id, resource: "forecast", resourceId: metricKey, after: { horizon, history: history.length } });
  }
  return result;
}
