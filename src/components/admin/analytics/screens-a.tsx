"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { Card, ErrorNote, Loading, StatusBadge, useApi } from "@/components/admin/system/shared";
import { BreakdownChart, FreshnessBadge, FunnelView, LineAreaChart, MetricCard, PeriodBar, formatValue, periodQuery } from "@/components/admin/analytics/dashboard-view";
import type { Freshness, MetricResult } from "@/lib/analytics/types";

// STEP 31 - the main analytics screens. Each is a shell over an API that enforces its own permission; nothing here decides access.

interface Widget { metric: MetricResult; breakdown?: MetricResult; series?: { available: boolean; message?: string; points: Array<{ day: string; value: number }>; currency: string } }
interface Dash { section: string; title: string; period: { label: string }; comparison: { label: string } | null; freshness: Freshness; widgets: Widget[]; restricted: string[]; funnel?: MetricResult[] }
interface Kpi { id: string; code: string; key: string; name: string; description: string; unit: string; value: number | null; currency: string; state: string; target: { value: number } | null; note: string | null; formula: string; version: number; period: string }

const useWindow = () => useState({ period: "LAST_30_DAYS", compare: "PREVIOUS_PERIOD", from: "", to: "" });

function NotOn({ message }: { message: string }) {
  const off = /not switched on/i.test(message);
  return <EmptyState title={off ? "This analytics area is not switched on yet" : "Not available"} description={off ? "An administrator can turn it on in Feature Flags (analytics.*). Nothing is calculated until then." : message} />;
}

function KpiStrip({ items }: { items: Kpi[] }) {
  if (!items.length) return null;
  return (
    <Card title="Key performance indicators">
      <ul className="divide-y divide-border text-sm">
        {items.map((k) => (
          <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div><p className="font-medium">{k.name}</p><p className="text-xs text-muted">{k.code} · {k.formula} · v{k.version} · {k.period}</p></div>
            <div className="flex items-center gap-3">
              <span className="tabular-nums">{k.value === null ? <span className="text-muted">{k.note ?? "Not available"}</span> : `${k.value.toLocaleString()}${k.unit === "PERCENT" ? "%" : ""}`}</span>
              {k.target ? <span className="text-xs text-muted">target {k.target.value}{k.unit === "PERCENT" ? "%" : ""}</span> : <span className="text-xs text-muted">no target set</span>}
              <StatusBadge status={k.state === "NOT_AVAILABLE" ? "NOT_CONFIGURED" : k.state === "ON_TRACK" ? "PASS" : k.state === "ATTENTION_REQUIRED" ? "WARN" : "CRITICAL"} />
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">Targets are set by the business; they are goals, not facts. A state describes a number against a target and never ranks people or teams.</p>
    </Card>
  );
}

// ---------------------------------------------------------------- Executive
export function ExecutiveClient({ canSummary }: { canSummary: boolean }) {
  const { show } = useToast();
  const [w, setW] = useWindow();
  const { data, error, loading } = useApi<{ dashboard: Dash; kpis: Kpi[] }>(`/api/admin/executive?${periodQuery(w)}`);
  const [summary, setSummary] = useState<{ summary: string; evidence: Array<{ label: string; value: string }>; potentialConflicts: string[]; limitations: string[]; suggestedNextStep: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  async function makeSummary() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/analytics/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "EXECUTIVE_SUMMARY", period: w.period === "CUSTOM" ? "LAST_30_DAYS" : w.period }) });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: typeof summary; message?: string };
      if (!res.ok || !j.ok) show(j.message ?? "The assistant is not available.", "error");
      else setSummary(j.result ?? null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Executive dashboard</h1>
          <p className="text-sm text-muted">A high-level view of platform activity. Every figure shows its definition, period, source and when it was last updated.</p>
        </div>
        <Link href="/admin/analytics" className="text-sm text-primary hover:underline">All analytics →</Link>
      </div>
      <PeriodBar {...w} onChange={setW} />
      {loading ? <Loading /> : error || !data ? <NotOn message={error ?? "Could not load."} /> : (
        <>
          <FreshnessBadge f={data.dashboard.freshness} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {data.dashboard.widgets.map((x) => <MetricCard key={x.metric.key} r={x.metric} period={data.dashboard.period.label} comparisonLabel={data.dashboard.comparison?.label} />)}
          </div>
          {data.dashboard.restricted.length > 0 && <p className="text-xs text-muted">Not shown because they need other permissions: {data.dashboard.restricted.join(", ")}.</p>}
          {data.dashboard.funnel && <FunnelView title="Applicant journey (cohort registered in the period)" stages={data.dashboard.funnel.map((f) => ({ label: f.name, value: f.values[0]?.display ?? null }))} />}
          <p className="text-xs text-muted">Each stage includes every stage before it. Not every applicant is expected to reach the end, and a step rate describes the past; it is not a target. “Married” counts only what staff have recorded.</p>
          <div className="grid gap-3 lg:grid-cols-2">
            {data.dashboard.widgets.filter((x) => x.series?.available).slice(0, 4).map((x) => <LineAreaChart key={x.metric.key} title={`${x.metric.name} — daily`} points={x.series!.points} area />)}
          </div>
          <KpiStrip items={data.kpis} />
          {canSummary && (
            <Card title="AI-assisted summary" action={<Button size="sm" variant="outline" onClick={makeSummary} disabled={busy}>{busy ? "Working…" : "Generate summary"}</Button>}>
              {!summary ? <p className="text-sm text-muted">Generates a plain summary from the figures above, with observed facts, calculations, interpretations and recommendations labelled separately. It needs human review.</p> : (
                <div className="space-y-3 text-sm">
                  <p className="font-medium">{summary.summary}</p>
                  <ul className="space-y-1">{summary.evidence.slice(0, 30).map((e, i) => <li key={i}><span className="text-muted">{e.label}: </span>{e.value}</li>)}</ul>
                  {summary.potentialConflicts.length > 0 && <div><p className="font-medium">Things that may need attention (rule-based interpretation)</p><ul className="list-disc ps-5">{summary.potentialConflicts.map((c, i) => <li key={i}>{c}</li>)}</ul></div>}
                  {summary.suggestedNextStep && <p><span className="font-medium">Recommendation: </span>{summary.suggestedNextStep}</p>}
                  <ul className="list-disc ps-5 text-xs text-muted">{summary.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Section dashboard
export function SectionClient({ section, title }: { section: string; title: string }) {
  const [w, setW] = useWindow();
  const isStaff = section === "staff";
  const { data, error, loading } = useApi<Dash>(isStaff ? null : `/api/admin/analytics/${section}?${periodQuery(w)}`);
  const staff = useApi<{ performance: unknown; workload: unknown; note: string }>(isStaff ? "/api/admin/analytics/staff" : null);
  return (
    <div className="space-y-4">
      <div>
        <Link href="/admin/analytics" className="text-sm text-primary hover:underline">← Analytics</Link>
        <h1 className="mt-1 text-xl font-semibold">{title}</h1>
      </div>
      {!isStaff && <PeriodBar {...w} onChange={setW} />}
      {isStaff ? (
        staff.loading ? <Loading /> : staff.error || !staff.data ? <NotOn message={staff.error ?? "Could not load."} /> : (
          <Card title="Staff and team workload">
            <p className="mb-2 text-sm text-muted">{staff.data.note}</p>
            <pre className="max-h-96 overflow-auto rounded-lg bg-background p-3 text-xs">{JSON.stringify(staff.data, null, 2)}</pre>
          </Card>
        )
      ) : loading ? <Loading /> : error || !data ? <NotOn message={error ?? "Could not load."} /> : (
        <>
          <FreshnessBadge f={data.freshness} />
          {data.widgets.length === 0 && <EmptyState title="Nothing to show" description="You do not have access to any metric in this section." />}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{data.widgets.map((x) => <MetricCard key={x.metric.key} r={x.metric} period={data.period.label} comparisonLabel={data.comparison?.label} />)}</div>
          <div className="grid gap-3 lg:grid-cols-2">
            {data.widgets.filter((x) => x.breakdown && x.breakdown.values.length > 0).map((x) => <BreakdownChart key={`b-${x.metric.key}`} r={x.breakdown!} />)}
            {data.widgets.filter((x) => x.series?.available).map((x) => <LineAreaChart key={`s-${x.metric.key}`} title={`${x.metric.name} — daily`} points={x.series!.points} area />)}
          </div>
          {data.restricted.length > 0 && <p className="text-xs text-muted">Restricted metrics (not shown to you): {data.restricted.join(", ")}.</p>}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Home
interface Home { flags: Record<string, boolean>; sections: Array<{ key: string; title: string }>; settings: { timezone: string; minGroupSize: number; freshnessSlaHours: number } }
export function AnalyticsHomeClient({ permissions }: { permissions: string[] }) {
  const can = (p: string) => permissions.includes(p);
  const { data, error, loading } = useApi<Home>("/api/admin/analytics");
  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? "Could not load."} />;
  const links = [
    ["/admin/executive", "Executive dashboard", can("analytics:dashboard:view")], ["/admin/analytics/cohorts", "Cohorts and retention", can("analytics:cross_domain:view") || can("analytics:sensitive:view")],
    ["/admin/analytics/metric-catalog", "Metric catalog", can("analytics:metrics:view")], ["/admin/analytics/governance", "Governance (KPIs, quality, alerts)", true],
    ["/admin/analytics/builder", "Dashboard builder", can("analytics:dashboard:create")], ["/admin/reports/builder", "Report builder", can("analytics:reports:view")],
    ["/admin/reports/executive", "Executive report", can("analytics:dashboard:view")], ["/admin/analytics/assistant", "Analytics assistant", can("ai:analytics:use")],
  ] as const;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Analytics &amp; BI</h1>
        <p className="text-sm text-muted">Business timezone {data.settings.timezone}. Breakdowns hide groups smaller than {data.settings.minGroupSize}. Daily figures are refreshed once a day and say so on every screen.</p>
      </div>
      {!data.flags["analytics.enabled"] && <div className="rounded-xl border border-warning/40 bg-warning/5 p-4 text-sm">Analytics is switched off. An administrator can turn on <code>analytics.enabled</code> (and the parts below) in Feature Flags.</div>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {links.filter(([, , ok]) => ok).map(([href, label]) => <Link key={href} href={href} className="rounded-xl border border-border bg-surface p-4 text-sm font-medium hover:border-primary">{label}</Link>)}
      </div>
      <Card title="Dashboards you can open">
        {data.sections.length === 0 ? <p className="text-sm text-muted">No section dashboards are available to your role.</p> : <div className="flex flex-wrap gap-2">{data.sections.map((s) => <Link key={s.key} href={`/admin/analytics/${s.key}`} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-primary">{s.title}</Link>)}{can("analytics:staff:view") && <Link href="/admin/analytics/staff" className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-primary">Staff performance</Link>}</div>}
      </Card>
      <Card title="Switches"><dl className="grid gap-1 sm:grid-cols-2">{Object.entries(data.flags).map(([k, v]) => <div key={k} className="flex justify-between text-sm"><dt className="text-muted">{k}</dt><dd>{v ? "On" : "Off"}</dd></div>)}</dl></Card>
    </div>
  );
}

// ---------------------------------------------------------------- Cohorts
interface Cohort { key: string; size: number | null; rates: { completed: number | null; verified: number | null; activeStatus: number | null; proposalEngaged: number | null; meetingEngaged: number | null; membershipRetention: number | null }; suppressed: boolean }
interface Retention { definition: string; note: string; windows: Array<{ day: number; windowDays: number; rows: Array<{ month: string; cohort: number; active: number; rate: number | null }>; overall: { cohort: number; active: number; rate: number | null } }> }
const KINDS = [["registration_month", "Registration month"], ["campaign", "Marketing campaign"], ["referral_source", "Referral source"], ["membership_start_month", "Membership start month"], ["lifecycle_stage", "Lifecycle stage"]];

export function CohortsClient() {
  const [tab, setTab] = useState("retention");
  const [kind, setKind] = useState("registration_month");
  const ret = useApi<Retention>(tab === "retention" ? "/api/admin/analytics/cohorts?kind=retention" : null);
  const coh = useApi<{ definition: string; rows: Cohort[]; minGroupSize: number }>(tab === "cohorts" ? `/api/admin/analytics/cohorts?kind=${kind}` : null);
  const pct = (v: number | null) => (v === null ? "—" : `${v}%`);
  return (
    <div className="space-y-4">
      <div><Link href="/admin/analytics" className="text-sm text-primary hover:underline">← Analytics</Link><h1 className="mt-1 text-xl font-semibold">Cohorts and retention</h1></div>
      <Tabs tabs={[{ value: "retention", label: "Retention (Day 1/7/30/60/90)" }, { value: "cohorts", label: "Cohorts" }]} value={tab} onChange={setTab} />
      {tab === "retention" && (ret.loading ? <Loading /> : ret.error || !ret.data ? <NotOn message={ret.error ?? "Could not load."} /> : (
        <div className="space-y-3">
          <p className="text-sm text-muted">{ret.data.definition}</p>
          <p className="text-xs text-muted">{ret.data.note}</p>
          {ret.data.windows.map((w) => (
            <Card key={w.day} title={`Day ${w.day} (${w.windowDays}-day window)`}>
              <table className="w-full text-sm"><thead><tr className="text-start text-muted"><th className="text-start font-medium">Registered in</th><th className="text-start font-medium">Cohort</th><th className="text-start font-medium">Active</th><th className="text-start font-medium">Retention</th></tr></thead>
                <tbody>{w.rows.map((r) => <tr key={r.month}><td>{r.month}</td><td>{r.cohort}</td><td>{r.active}</td><td>{pct(r.rate)}</td></tr>)}<tr className="font-medium"><td>Overall</td><td>{w.overall.cohort}</td><td>{w.overall.active}</td><td>{pct(w.overall.rate)}</td></tr></tbody></table>
              {w.rows.length === 0 && <p className="text-sm text-muted">Insufficient verified data.</p>}
            </Card>
          ))}
        </div>
      ))}
      {tab === "cohorts" && (
        <div className="space-y-3">
          <Field label="Group applicants by"><Select value={kind} onChange={(e) => setKind(e.target.value)} className="w-64">{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          {coh.loading ? <Loading /> : coh.error || !coh.data ? <NotOn message={coh.error ?? "Could not load."} /> : (
            <Card title="Cohort table">
              <p className="mb-2 text-xs text-muted">{coh.data.definition}</p>
              <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead><tr className="text-muted"><th className="text-start font-medium">Group</th><th className="text-start font-medium">Applicants</th><th className="text-start font-medium">Completed profile</th><th className="text-start font-medium">Verified</th><th className="text-start font-medium">Active</th><th className="text-start font-medium">Proposal activity</th><th className="text-start font-medium">Meeting activity</th><th className="text-start font-medium">Membership kept</th></tr></thead>
                <tbody>{coh.data.rows.map((r) => r.suppressed ? <tr key={r.key}><td>{r.key}</td><td colSpan={7} className="text-muted">Insufficient data for this breakdown.</td></tr> : <tr key={r.key}><td>{r.key.replace(/_/g, " ")}</td><td>{r.size}</td><td>{pct(r.rates.completed)}</td><td>{pct(r.rates.verified)}</td><td>{pct(r.rates.activeStatus)}</td><td>{pct(r.rates.proposalEngaged)}</td><td>{pct(r.rates.meetingEngaged)}</td><td>{pct(r.rates.membershipRetention)}</td></tr>)}</tbody></table></div>
              {coh.data.rows.length === 0 && <p className="text-sm text-muted">Insufficient verified data.</p>}
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Assistant
interface AiOut { ok: boolean; result?: { summary: string; evidence: Array<{ label: string; value: string }>; limitations: string[]; suggestedNextStep: string | null }; message?: string }
const EXAMPLES = ["How many profiles were verified this month?", "Which marketing channels generated the most leads?", "How many open support cases are there?", "Compare new applicants this month with last month"];

export function AssistantClient() {
  const { show } = useToast();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<AiOut | null>(null);
  async function ask(text: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/analytics/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "QUESTION", question: text }) });
      const j = (await res.json().catch(() => ({}))) as AiOut;
      if (!res.ok || !j.ok) show(j.message ?? "The assistant is not available.", "error");
      setOut(res.ok ? j : null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <div><Link href="/admin/analytics" className="text-sm text-primary hover:underline">← Analytics</Link><h1 className="mt-1 text-xl font-semibold">Analytics assistant</h1>
        <p className="text-sm text-muted">Ask about the platform&apos;s figures in plain words. Your question is turned into a validated query over the metric catalog (never SQL) and answered only from data you are allowed to see. It does not predict anything about any person.</p></div>
      <Card>
        <div className="flex flex-wrap gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} maxLength={300} placeholder="e.g. How many profiles were verified this month?" className="min-w-64 flex-1" onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) void ask(q); }} />
          <Button onClick={() => ask(q)} disabled={busy || !q.trim()}>{busy ? "Working…" : "Ask"}</Button>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">{EXAMPLES.map((e) => <button key={e} type="button" className="rounded-full border border-border px-3 py-1 text-xs text-muted hover:bg-surface-muted" onClick={() => { setQ(e); void ask(e); }}>{e}</button>)}</div>
      </Card>
      {out?.result && (
        <Card title="Answer">
          <p className="text-sm">{out.result.summary}</p>
          <ul className="mt-2 space-y-1 text-xs">{out.result.evidence.map((e, i) => <li key={i}><span className="text-muted">{e.label}: </span>{e.value}</li>)}</ul>
          <ul className="mt-2 list-disc ps-5 text-xs text-muted">{out.result.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Executive report (printable summary)
export function ExecutiveReportClient() {
  const [w, setW] = useWindow();
  const { data, error, loading } = useApi<{ dashboard: Dash; kpis: Kpi[] }>(`/api/admin/executive?${periodQuery(w)}`);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-xl font-semibold">Executive report</h1><p className="text-sm text-muted">A printable summary. Every line traces to a metric definition (open the “i” on a card).</p></div>
        <Button size="sm" variant="outline" onClick={() => window.print()}>Print / save as PDF</Button>
      </div>
      <PeriodBar {...w} onChange={setW} />
      {loading ? <Loading /> : error || !data ? <NotOn message={error ?? "Could not load."} /> : (
        <>
          <FreshnessBadge f={data.dashboard.freshness} />
          <table className="w-full text-sm">
            <caption className="sr-only">Executive figures for {data.dashboard.period.label}</caption>
            <thead><tr className="text-muted"><th className="text-start font-medium">Figure</th><th className="text-start font-medium">Value</th><th className="text-start font-medium">Definition</th><th className="text-start font-medium">Source</th></tr></thead>
            <tbody>{data.dashboard.widgets.map((x) => <tr key={x.metric.key} className="border-t border-border align-top"><td className="py-1.5 pe-2">{x.metric.name}</td><td className="pe-2 tabular-nums">{x.metric.values.map((v) => formatValue(x.metric, v)).join("; ")}</td><td className="pe-2 text-xs text-muted">{x.metric.definition.formula}</td><td className="text-xs text-muted">{x.metric.definition.source}</td></tr>)}</tbody>
          </table>
          {data.dashboard.funnel && <FunnelView title="Applicant journey" stages={data.dashboard.funnel.map((f) => ({ label: f.name, value: f.values[0]?.display ?? null }))} />}
          <KpiStrip items={data.kpis} />
          <p className="text-xs text-muted">Period: {data.dashboard.period.label}. {data.dashboard.freshness.label}. Rates need a minimum sample; breakdowns hide groups that are too small.</p>
        </>
      )}
    </div>
  );
}
