"use client";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/form";
import type { DateRangePreset } from "@/lib/reports/types";

const PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "Last 7 Days" },
  { value: "30d", label: "Last 30 Days" },
  { value: "90d", label: "Last 90 Days" },
  { value: "thisYear", label: "This Year" },
  { value: "custom", label: "Custom Range" },
];

// Spec §1's 7 date-range filters.
export function DateRangePicker({
  preset,
  from,
  to,
  onChange,
}: {
  preset: DateRangePreset;
  from: string;
  to: string;
  onChange: (preset: DateRangePreset, from: string, to: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => onChange(p.value, from, to)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              preset === p.value ? "bg-primary text-primary-foreground" : "text-muted hover:bg-surface-muted"
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {preset === "custom" && (
        <div className="flex items-center gap-2">
          <Input type="date" value={from} onChange={(e) => onChange("custom", e.target.value, to)} className="w-auto" />
          <span className="text-xs text-muted">to</span>
          <Input type="date" value={to} onChange={(e) => onChange("custom", from, e.target.value)} className="w-auto" />
        </div>
      )}
    </div>
  );
}
