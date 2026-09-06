// Generalizes the in-memory day-bucketing idiom already used by
// src/app/api/admin/communication-center/analytics/route.ts — Prisma has no
// native date-trunc groupBy, so every "volume over time" section buckets a
// findMany's rows in memory. Deliberately UTC-based (not date-fns's
// local-timezone `format()`) so this behaves identically on Vercel (UTC)
// regardless of the host machine's local timezone — see date-range.ts for
// the same reasoning. Pure — rows are expected to already be scoped to the
// desired date range by the caller's `where` clause.
function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function bucketByDay<T>(rows: T[], getDate: (row: T) => Date): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const day = utcDayKey(getDate(row));
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// Multi-series variant (spec §3's "new vs verified vs active vs rejected",
// proposals-by-status-over-time, etc.) — feeds the new TrendChart component.
export function bucketByDayMultiSeries<T>(
  rows: T[],
  getDate: (row: T) => Date,
  getSeriesKey: (row: T) => string
): { label: string; series: Record<string, number> }[] {
  const byDay = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const day = utcDayKey(getDate(row));
    const key = getSeriesKey(row);
    const existing = byDay.get(day) ?? {};
    existing[key] = (existing[key] ?? 0) + 1;
    byDay.set(day, existing);
  }
  return Array.from(byDay.entries())
    .map(([label, series]) => ({ label, series }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
