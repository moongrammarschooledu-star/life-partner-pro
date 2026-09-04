"use client";

import { cn } from "@/lib/utils";

export interface TrendPoint {
  label: string;
  male: number;
  female: number;
}

const PERIODS: { value: string; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 Days" },
  { value: "30d", label: "30 Days" },
  { value: "3m", label: "3 Months" },
  { value: "6m", label: "6 Months" },
  { value: "1y", label: "1 Year" },
];

// Hand-rolled grouped bar chart — matches the rest of the codebase's
// no-external-chart-library convention (see bar-chart.tsx).
export function RegistrationTrendChart({
  data,
  period,
  onPeriodChange,
}: {
  data: TrendPoint[];
  period: string;
  onPeriodChange: (period: string) => void;
}) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.male, d.female)));

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1">
        {PERIODS.map((p) => (
          <button
            key={p.value}
            onClick={() => onPeriodChange(p.value)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              period === p.value ? "bg-primary text-primary-foreground" : "text-muted hover:bg-surface-muted"
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="mb-3 flex items-center gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-primary" /> Male
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-accent" /> Female
        </span>
      </div>
      {data.length === 0 ? (
        <p className="text-sm text-muted">No registrations in this period.</p>
      ) : (
        <div className="flex h-40 items-end gap-1.5 overflow-x-auto">
          {data.map((d, i) => (
            <div key={i} className="flex min-w-[1.5rem] flex-1 flex-col items-center gap-1" title={`${d.label}: ${d.male}M / ${d.female}F`}>
              <div className="flex h-32 w-full items-end gap-0.5">
                <div className="flex-1 rounded-t-sm bg-primary" style={{ height: `${(d.male / max) * 100}%` }} />
                <div className="flex-1 rounded-t-sm bg-accent" style={{ height: `${(d.female / max) * 100}%` }} />
              </div>
              <span className="truncate text-[10px] text-muted">{d.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
