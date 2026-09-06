// Generic multi-series time-trend chart (spec §3's new-vs-verified-vs-active-
// vs-rejected, proposals-by-status-over-time, etc.) — generalizes
// registration-trend-chart.tsx's hardcoded male/female shape to an arbitrary
// number of named series. That component is left untouched (the Dashboard
// has a hard dependency on its exact shape); this is a new sibling.
export interface TrendSeriesConfig {
  key: string;
  label: string;
  colorClass: string; // e.g. "bg-primary"
}

export function TrendChart({
  data,
  seriesConfig,
}: {
  data: { label: string; series: Record<string, number> }[];
  seriesConfig: TrendSeriesConfig[];
}) {
  const max = Math.max(1, ...data.flatMap((d) => seriesConfig.map((s) => d.series[s.key] ?? 0)));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-muted">
        {seriesConfig.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-sm ${s.colorClass}`} /> {s.label}
          </span>
        ))}
      </div>
      {data.length === 0 ? (
        <p className="text-sm text-muted">Not enough data available for this report.</p>
      ) : (
        <div className="flex h-40 items-end gap-1.5 overflow-x-auto">
          {data.map((d, i) => (
            <div key={i} className="flex min-w-[1.5rem] flex-1 flex-col items-center gap-1" title={d.label}>
              <div className="flex h-32 w-full items-end gap-0.5">
                {seriesConfig.map((s) => (
                  <div
                    key={s.key}
                    className={`flex-1 rounded-t-sm ${s.colorClass}`}
                    style={{ height: `${((d.series[s.key] ?? 0) / max) * 100}%` }}
                  />
                ))}
              </div>
              <span className="truncate text-[10px] text-muted">{d.label.slice(5)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
