"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Info, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select } from "@/components/ui/form";
import { FunnelView, HBarChart, LineAreaChart, PieChart } from "@/components/admin/analytics/charts";
import { formatMoney } from "@/lib/finance/money";
import { COMPARE_MODES, PERIOD_PRESETS } from "@/lib/analytics/time";
import type { Freshness, MetricResult, MetricValueRow } from "@/lib/analytics/types";

// STEP 31 - presentation of analytics results. A card always shows: the figure, its period, how it compares (or "Not available" - a
// percentage of zero is never shown), and a "definition" disclosure with the formula, source, exclusions, owner and version.

export function formatValue(r: Pick<MetricResult, "unit">, v: MetricValueRow): string {
  if (v.suppressed) return "Insufficient data for this breakdown.";
  if (v.display === null) return "Insufficient verified data";
  if (r.unit === "MINOR_MONEY") return formatMoney(v.display, v.currency || "PKR", 2);
  if (r.unit === "PERCENT") return `${v.display}%`;
  if (r.unit === "HOURS") return `${v.display} h`;
  return v.display.toLocaleString();
}

export function FreshnessBadge({ f }: { f: Freshness | null | undefined }) {
  if (!f) return null;
  const variant = f.refreshStatus === "OK" || f.refreshStatus === "NOT_APPLICABLE" ? "muted" : "warning";
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-xs text-muted">
      <Badge variant={variant}>{f.mode === "LIVE" ? "Calculated live" : f.mode === "DAILY_MART" ? "Daily data" : "Mixed"}</Badge>
      <span>{f.label}</span>
      {f.refreshStatus === "STALE" && <span className="text-warning">Data is older than the allowed time.</span>}
      {f.refreshStatus === "NEVER_REFRESHED" && <span className="text-warning">The daily data has not been built yet.</span>}
      {f.refreshStatus === "FAILED" && <span className="text-danger">The last refresh failed.</span>}
    </span>
  );
}

export function MetricCard({ r, period, comparisonLabel }: { r: MetricResult; period: string; comparisonLabel?: string | null }) {
  const [open, setOpen] = useState(false);
  const rows = r.values;
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-muted">{r.name}</p>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`Definition of ${r.name}`} className="text-muted hover:text-foreground"><Info className="h-4 w-4" /></button>
      </div>
      {rows.map((v) => {
        const k = `${v.dimensionValue}|${v.currency}`;
        const c = r.changePct?.[k];
        const Icon = c === null || c === undefined || c === 0 ? Minus : c > 0 ? ArrowUp : ArrowDown;
        return (
          <div key={k} className="mt-1">
            <p className="text-2xl font-semibold tabular-nums">{formatValue(r, v)}</p>
            {r.changePct && (
              <p className="flex items-center gap-1 text-xs text-muted">
                <Icon className="h-3 w-3" aria-hidden="true" />
                {c === null || c === undefined ? "Change: Not available" : `${c > 0 ? "+" : ""}${c}% vs ${comparisonLabel ?? "previous period"}`}
              </p>
            )}
          </div>
        );
      })}
      <p className="mt-2 text-xs text-muted">{r.kind === "SNAPSHOT" ? "As of now" : period} · {r.definition.source.split(",")[0]}</p>
      {open && (
        <dl className="mt-2 space-y-1 border-t border-border pt-2 text-xs">
          <div><dt className="inline font-medium">Definition: </dt><dd className="inline">{r.definition.formula}</dd></div>
          <div><dt className="inline font-medium">Source: </dt><dd className="inline">{r.definition.source}</dd></div>
          {r.definition.exclusions.length > 0 && <div><dt className="inline font-medium">Excludes: </dt><dd className="inline">{r.definition.exclusions.join("; ")}</dd></div>}
          <div><dt className="inline font-medium">Owner / version: </dt><dd className="inline">{r.definition.owner} · {r.version}</dd></div>
          {r.note && <div className="text-muted">{r.note}</div>}
        </dl>
      )}
    </div>
  );
}

export function PeriodBar({ period, compare, from, to, onChange }: { period: string; compare: string; from: string; to: string; onChange: (v: { period: string; compare: string; from: string; to: string }) => void }) {
  const label = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="Period"><Select value={period} onChange={(e) => onChange({ period: e.target.value, compare, from, to })} className="w-48">{PERIOD_PRESETS.map((p) => <option key={p} value={p}>{label(p)}</option>)}</Select></Field>
      {period === "CUSTOM" && (
        <>
          <Field label="From"><Input type="date" value={from} onChange={(e) => onChange({ period, compare, from: e.target.value, to })} /></Field>
          <Field label="To"><Input type="date" value={to} onChange={(e) => onChange({ period, compare, from, to: e.target.value })} /></Field>
        </>
      )}
      <Field label="Compare with"><Select value={compare} onChange={(e) => onChange({ period, compare: e.target.value, from, to })} className="w-52">{COMPARE_MODES.map((c) => <option key={c} value={c}>{c === "NONE" ? "No comparison" : label(c)}</option>)}</Select></Field>
    </div>
  );
}

export function periodQuery(v: { period: string; compare: string; from: string; to: string }): string {
  const q = new URLSearchParams({ period: v.period, compare: v.compare });
  if (v.period === "CUSTOM" && v.from && v.to) {
    q.set("from", v.from);
    q.set("to", v.to);
  }
  return q.toString();
}

// breakdown widget: bar for most, pie only for counts that are parts of a whole
export function BreakdownChart({ r }: { r: MetricResult }) {
  const data = r.values.map((v) => ({ label: v.dimensionValue.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()), value: v.suppressed ? null : v.display, note: v.suppressed ? "Insufficient data for this breakdown." : undefined }));
  const unit = r.unit === "PERCENT" ? "%" : r.unit === "HOURS" ? " h" : undefined;
  if (r.unit === "COUNT" && !r.definition.formula.toLowerCase().includes("average") && data.length >= 2 && data.length <= 7 && data.every((d) => d.value !== null)) return <PieChart title={`${r.name} — split`} data={data.map((d) => ({ label: d.label, value: d.value as number }))} />;
  return <HBarChart title={`${r.name} — split`} data={data} unit={unit} />;
}

export { FunnelView, HBarChart, LineAreaChart, PieChart };
