import { HttpError } from "@/lib/http-error";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { COMPARE_MODES, PERIOD_PRESETS, type CompareMode, type PeriodPreset } from "@/lib/analytics/time";
import { loadViewer, type DbViewer } from "@/lib/analytics/viewers";

// STEP 31 - small helpers the analytics API routes share (the routes themselves each call requireAdmin(<permission>) first).

export type AnalyticsFlag = "analytics.enabled" | "analytics.pipeline.enabled" | "analytics.reports.enabled" | "analytics.scheduled_reports.enabled" | "analytics.alerts.enabled" | "analytics.forecast.enabled";

// With a flag off the feature does not exist: the API answers 404 with a plain message and nothing is read or written.
export async function assertEnabled(...flags: AnalyticsFlag[]): Promise<void> {
  for (const f of ["analytics.enabled", ...flags] as AnalyticsFlag[]) {
    if (!(await isFeatureEnabled(f))) throw new HttpError(404, "This part of analytics is not switched on.");
  }
}

export function periodParams(url: string): { period: PeriodPreset; compare: CompareMode; from?: string; to?: string } {
  const q = new URL(url).searchParams;
  const p = q.get("period") ?? "LAST_30_DAYS";
  const c = q.get("compare") ?? "PREVIOUS_PERIOD";
  if (!(PERIOD_PRESETS as string[]).includes(p)) throw new HttpError(400, "Unknown period.");
  if (!(COMPARE_MODES as string[]).includes(c)) throw new HttpError(400, "Unknown comparison.");
  return { period: p as PeriodPreset, compare: c as CompareMode, from: q.get("from") ?? undefined, to: q.get("to") ?? undefined };
}

export async function dbViewerFor(adminId: string): Promise<DbViewer> {
  const v = await loadViewer(adminId);
  if (!v || !v.active) throw new HttpError(401, "Unauthorized");
  return v;
}
