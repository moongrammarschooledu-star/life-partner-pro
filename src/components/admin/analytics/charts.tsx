"use client";

import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// STEP 31 - accessible charts. Every chart is wrapped in ChartFrame, which gives it a title, a plain-language summary (what a screen
// reader announces), role="img" with an aria-label, and a "View as table" switch that shows the SAME numbers as a real <table>.
// Colour is never the only carrier of meaning: values are printed next to bars/points and the table lists everything.

export interface TableAlt { columns: string[]; rows: Array<Array<string | number>> }

export function ChartFrame({ title, summary, table, children, className }: { title: string; summary: string; table: TableAlt; children: ReactNode; className?: string }) {
  const [asTable, setAsTable] = useState(false);
  const id = useId();
  return (
    <figure className={cn("rounded-xl border border-border bg-surface p-4", className)} aria-labelledby={`${id}-t`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <figcaption id={`${id}-t`} className="font-medium">{title}</figcaption>
        <button type="button" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable} className="rounded border border-border px-2 py-0.5 text-xs text-muted hover:bg-surface-muted">
          {asTable ? "View as chart" : "View as table"}
        </button>
      </div>
      <p className="sr-only">{summary}</p>
      {asTable ? (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-start text-sm">
            <caption className="sr-only">{title}</caption>
            <thead><tr>{table.columns.map((c) => <th key={c} scope="col" className="border-b border-border px-2 py-1 text-start font-medium text-muted">{c}</th>)}</tr></thead>
            <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className="border-b border-border/50 px-2 py-1">{typeof v === "number" ? v.toLocaleString() : v}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div role="img" aria-label={`${title}. ${summary}`}>{children}</div>
      )}
    </figure>
  );
}

const PALETTE = ["#7a1033", "#2563eb", "#059669", "#d97706", "#7c3aed", "#0891b2", "#dc2626", "#64748b"];
const fmt = (n: number) => n.toLocaleString();

export function HBarChart({ title, data, unit }: { title: string; data: Array<{ label: string; value: number | null; note?: string }>; unit?: string }) {
  const rows = data.filter((d) => d.value !== null) as Array<{ label: string; value: number }>;
  const max = Math.max(1, ...rows.map((d) => d.value));
  const summary = rows.length ? `${rows.length} groups. Largest: ${[...rows].sort((a, b) => b.value - a.value)[0].label} at ${fmt([...rows].sort((a, b) => b.value - a.value)[0].value)}${unit ?? ""}.` : "No data for this breakdown.";
  return (
    <ChartFrame title={title} summary={summary} table={{ columns: ["Group", `Value${unit ? ` (${unit})` : ""}`], rows: data.map((d) => [d.label, d.value === null ? (d.note ?? "Insufficient data for this breakdown.") : d.value]) }}>
      <ul className="space-y-1.5">
        {data.map((d) => (
          <li key={d.label} className="flex items-center gap-2 text-sm">
            <span className="w-36 shrink-0 truncate text-muted" title={d.label}>{d.label}</span>
            <span className="h-3 flex-1 overflow-hidden rounded bg-surface-muted">
              {d.value !== null && <span className="block h-3 rounded bg-primary" style={{ width: `${Math.max(2, (d.value / max) * 100)}%` }} />}
            </span>
            <span className="w-20 shrink-0 text-end tabular-nums">{d.value === null ? "—" : `${fmt(d.value)}${unit ?? ""}`}</span>
          </li>
        ))}
      </ul>
    </ChartFrame>
  );
}

export function LineAreaChart({ title, points, area, unit }: { title: string; points: Array<{ day: string; value: number }>; area?: boolean; unit?: string }) {
  const W = 560;
  const H = 160;
  const P = 24;
  const max = Math.max(1, ...points.map((p) => p.value));
  const x = (i: number) => P + (points.length <= 1 ? 0 : (i / (points.length - 1)) * (W - P * 2));
  const y = (v: number) => H - P - (v / max) * (H - P * 2);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const first = points[0];
  const last = points[points.length - 1];
  const summary = points.length ? `${points.length} days from ${first.day} to ${last.day}. Highest ${fmt(Math.max(...points.map((p) => p.value)))}${unit ?? ""}, lowest ${fmt(Math.min(...points.map((p) => p.value)))}${unit ?? ""}, latest ${fmt(last.value)}${unit ?? ""}.` : "No daily data yet.";
  return (
    <ChartFrame title={title} summary={summary} table={{ columns: ["Day", `Value${unit ? ` (${unit})` : ""}`], rows: points.map((p) => [p.day, p.value]) }}>
      {points.length === 0 ? <p className="text-sm text-muted">Daily figures appear after the first data-mart refresh.</p> : (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-40 w-full" aria-hidden="true" focusable="false">
          <line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke="currentColor" strokeOpacity="0.2" />
          {area && <path d={`${path} L${x(points.length - 1)},${H - P} L${x(0)},${H - P} Z`} fill={PALETTE[0]} fillOpacity="0.15" />}
          <path d={path} fill="none" stroke={PALETTE[0]} strokeWidth="2" />
          {points.length <= 45 && points.map((p, i) => <circle key={p.day} cx={x(i)} cy={y(p.value)} r="2.5" fill={PALETTE[0]}><title>{`${p.day}: ${fmt(p.value)}`}</title></circle>)}
          <text x={P} y={12} fontSize="10" fill="currentColor" fillOpacity="0.6">{fmt(max)}</text>
          <text x={P} y={H - 6} fontSize="10" fill="currentColor" fillOpacity="0.6">{first.day}</text>
          <text x={W - P} y={H - 6} fontSize="10" textAnchor="end" fill="currentColor" fillOpacity="0.6">{last.day}</text>
        </svg>
      )}
    </ChartFrame>
  );
}

export function PieChart({ title, data }: { title: string; data: Array<{ label: string; value: number }> }) {
  const rows = data.filter((d) => d.value > 0).slice(0, 8);
  const total = rows.reduce((s, d) => s + d.value, 0);
  const R = 60;
  const slices = rows.map((d, i) => {
    const before = rows.slice(0, i).reduce((s, x) => s + x.value, 0);
    const a0 = (before / total) * Math.PI * 2;
    const a1 = ((before + d.value) / total) * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (a: number) => `${(70 + R * Math.sin(a)).toFixed(2)},${(70 - R * Math.cos(a)).toFixed(2)}`;
    return { d, color: PALETTE[i % PALETTE.length], path: rows.length === 1 ? `M70,${70 - R} A${R},${R} 0 1 1 69.99,${70 - R} Z` : `M70,70 L${p(a0)} A${R},${R} 0 ${large} 1 ${p(a1)} Z` };
  });
  const summary = total ? `${rows.length} parts of a total of ${fmt(total)}. Largest: ${[...rows].sort((a, b) => b.value - a.value)[0].label}.` : "No data for this breakdown.";
  return (
    <ChartFrame title={title} summary={summary} table={{ columns: ["Part", "Value", "Share"], rows: rows.map((d) => [d.label, d.value, `${Math.round((d.value / (total || 1)) * 100)}%`]) }}>
      {total === 0 ? <p className="text-sm text-muted">No data for this breakdown.</p> : (
        <div className="flex flex-wrap items-center gap-4">
          <svg viewBox="0 0 140 140" className="h-36 w-36" aria-hidden="true" focusable="false">{slices.map((s) => <path key={s.d.label} d={s.path} fill={s.color} stroke="white" strokeWidth="1" />)}</svg>
          <ul className="space-y-1 text-sm">{slices.map((s) => <li key={s.d.label} className="flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: s.color }} aria-hidden="true" />{s.d.label}: <span className="tabular-nums">{fmt(s.d.value)}</span> ({Math.round((s.d.value / total) * 100)}%)</li>)}</ul>
        </div>
      )}
    </ChartFrame>
  );
}

export function FunnelView({ title, stages }: { title: string; stages: Array<{ label: string; value: number | null }> }) {
  const known = stages.filter((s) => s.value !== null) as Array<{ label: string; value: number }>;
  const top = Math.max(1, ...known.map((s) => s.value));
  return (
    <ChartFrame title={title} summary={`${stages.length} stages. ${known.map((s) => `${s.label} ${fmt(s.value)}`).join(", ")}.`} table={{ columns: ["Stage", "Applicants", "Of previous stage"], rows: stages.map((s, i) => { const prev = i > 0 ? stages[i - 1].value : null; return [s.label, s.value === null ? "Insufficient verified data" : s.value, s.value !== null && prev ? (prev >= 5 ? `${Math.round((s.value / prev) * 100)}%` : "Not available") : "—"]; }) }}>
      <ol className="space-y-1.5">
        {stages.map((s, i) => {
          const prev = i > 0 ? stages[i - 1].value : null;
          const rate = s.value !== null && prev !== null && prev >= 5 ? `${Math.round((s.value / prev) * 100)}% of previous` : "";
          return (
            <li key={s.label} className="flex items-center gap-2 text-sm">
              <span className="w-40 shrink-0 truncate text-muted">{s.label}</span>
              <span className="h-5 flex-1 rounded bg-surface-muted">{s.value !== null && <span className="flex h-5 items-center rounded bg-primary/80 px-1.5 text-xs text-white" style={{ width: `${Math.max(4, (s.value / top) * 100)}%` }}>{fmt(s.value)}</span>}</span>
              <span className="w-28 shrink-0 text-end text-xs text-muted">{rate}</span>
            </li>
          );
        })}
      </ol>
    </ChartFrame>
  );
}
