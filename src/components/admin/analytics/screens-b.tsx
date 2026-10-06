"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { Card, ErrorNote, Loading, StatusBadge, timeAgo, useApi } from "@/components/admin/system/shared";
import { act } from "@/components/admin/marketing/shared";
import { BreakdownChart, FreshnessBadge, HBarChart, LineAreaChart, MetricCard, PeriodBar, periodQuery } from "@/components/admin/analytics/dashboard-view";
import type { Freshness, MetricResult } from "@/lib/analytics/types";

type Can = (p: string) => boolean;

interface CatalogItem { key: string; name: string; description: string; section: string; unit: string; kind: string; formula: string; source: string; filters: string[]; exclusions: string[]; dimensions: string[]; note: string | null; computeVersion: string; liveOnly: boolean; restricted: boolean; governance: { code: string; status: string; version: number; owner: string | null; reviewerId: string | null; reviewedAt: string | null } | null }

function useCatalog() {
  return useApi<{ items: CatalogItem[] }>("/api/admin/analytics/metrics");
}

// ---------------------------------------------------------------- Metric catalog
export function CatalogClient({ permissions }: { permissions: string[] }) {
  const can: Can = (p) => permissions.includes(p);
  const { show } = useToast();
  const { data, error, loading, reload } = useCatalog();
  const [q, setQ] = useState("");
  const [section, setSection] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const sections = useMemo(() => [...new Set((data?.items ?? []).map((m) => m.section))].sort(), [data]);
  const items = (data?.items ?? []).filter((m) => (!section || m.section === section) && (!q || `${m.name} ${m.key} ${m.description}`.toLowerCase().includes(q.toLowerCase())));
  async function step(key: string, action: string) {
    const reason = window.prompt("Reason");
    if (reason && (await act(show, `/api/admin/analytics/metrics/${encodeURIComponent(key)}`, "POST", { action, reason }, "Done."))) reload();
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><Link href="/admin/analytics" className="text-sm text-primary hover:underline">← Analytics</Link><h1 className="mt-1 text-xl font-semibold">Metric catalog</h1>
          <p className="text-sm text-muted">One definition for every figure. A metric&apos;s formula is versioned: a change makes a new version and history is never rewritten.</p></div>
        {can("analytics:metrics:create") && <Button size="sm" variant="outline" onClick={async () => { if (await act(show, "/api/admin/analytics/metrics", "POST", { action: "INSTALL" }, "Governance records created.")) reload(); }}>Create governance records</Button>}
      </div>
      <div className="flex flex-wrap gap-3"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search metrics" className="w-64" /><Select value={section} onChange={(e) => setSection(e.target.value)} className="w-48"><option value="">All sections</option>{sections.map((s) => <option key={s} value={s}>{s}</option>)}</Select></div>
      {loading ? <Loading /> : error || !data ? <ErrorNote message={error ?? "Could not load."} /> : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {items.map((m) => (
            <li key={m.key} className="p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button type="button" onClick={() => setOpen(open === m.key ? null : m.key)} className="text-start font-medium text-primary hover:underline" aria-expanded={open === m.key}>{m.name}</button>
                <div className="flex items-center gap-2 text-xs text-muted"><code>{m.key}</code>{m.restricted && <span>restricted</span>}{m.governance ? <StatusBadge status={m.governance.status} /> : <span>no governance record</span>}</div>
              </div>
              {open === m.key && (
                <div className="mt-2 space-y-1 text-xs">
                  <p>{m.description}</p>
                  <p><span className="font-medium">Formula: </span>{m.formula}</p>
                  <p><span className="font-medium">Source: </span>{m.source}</p>
                  {m.exclusions.length > 0 && <p><span className="font-medium">Exclusions: </span>{m.exclusions.join("; ")}</p>}
                  <p><span className="font-medium">Unit / kind: </span>{m.unit.toLowerCase().replace("_", " ")} · {m.kind.toLowerCase()}{m.liveOnly ? " · always calculated live" : ""} · {m.computeVersion}{m.dimensions.length ? ` · breakdowns: ${m.dimensions.join(", ")}` : ""}</p>
                  {m.governance && <p><span className="font-medium">Owner / review: </span>{m.governance.owner ?? "unassigned"} · {m.governance.code} · v{m.governance.version}{m.governance.reviewedAt ? ` · reviewed ${timeAgo(m.governance.reviewedAt)}` : " · not yet reviewed"}</p>}
                  {m.note && <p className="text-muted">{m.note}</p>}
                  {m.governance && can("analytics:metrics:manage") && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {m.governance.status === "DRAFT" && <Button size="sm" variant="outline" onClick={() => step(m.key, "SUBMIT")}>Submit for review</Button>}
                      {m.governance.status === "UNDER_REVIEW" && <Button size="sm" variant="outline" onClick={() => step(m.key, "APPROVE")}>Approve</Button>}
                      {m.governance.status === "APPROVED" && <Button size="sm" onClick={() => step(m.key, "ACTIVATE")}>Activate</Button>}
                      {["ACTIVE", "APPROVED"].includes(m.governance.status) && <Button size="sm" variant="outline" onClick={() => step(m.key, "SUSPEND")}>Suspend</Button>}
                      {m.governance.status === "SUSPENDED" && <Button size="sm" variant="outline" onClick={() => step(m.key, "REACTIVATE")}>Reactivate</Button>}
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Governance
interface KpiRow { id: string; code: string; key: string; name: string; status: string; version: number; formula: string; frequency: string; unit: string; value: number | null; state: string; target: { value: number } | null }
interface Issue { id: string; label: string; subjectType: string; subjectRef: string; severity: string; status: string; ignoreReason: string | null; detectedAt: string }
interface Recon { runId: string; status: string; startedAt: string; rangeFrom: string; rangeTo: string; reconciled: number; variances: number; items: Array<{ domain: string; label: string; currency: string; operational: number; analytics: number; variance: number; status: string; note: string | null }> }

export function GovernanceClient({ permissions }: { permissions: string[] }) {
  const can: Can = (p) => permissions.includes(p);
  const tabs = [
    { value: "kpis", label: "KPIs", show: can("analytics:kpi:view") }, { value: "quality", label: "Data quality", show: can("analytics:data_quality:view") },
    { value: "recon", label: "Reconciliation", show: can("analytics:reconciliation:view") }, { value: "pipeline", label: "Data refresh", show: can("analytics:pipeline:view") },
    { value: "alerts", label: "Alerts", show: can("analytics:alerts:view") }, { value: "forecast", label: "Forecasts", show: can("analytics:forecast:view") },
    { value: "settings", label: "Settings", show: true }, { value: "audit", label: "Audit", show: can("analytics:audit:view") },
  ].filter((t) => t.show);
  const [tab, setTab] = useState(tabs[0]?.value ?? "settings");
  return (
    <div className="space-y-4">
      <div><Link href="/admin/analytics" className="text-sm text-primary hover:underline">← Analytics</Link><h1 className="mt-1 text-xl font-semibold">Analytics governance</h1>
        <p className="text-sm text-muted">KPI definitions and targets, data quality, reconciliation, refresh status, alert rules, forecasts, settings and the audit trail.</p></div>
      <Tabs tabs={tabs.map(({ value, label }) => ({ value, label }))} value={tab} onChange={setTab} />
      {tab === "kpis" && <KpisTab can={can} />}
      {tab === "quality" && <QualityTab can={can} />}
      {tab === "recon" && <ReconTab can={can} />}
      {tab === "pipeline" && <PipelineTab can={can} />}
      {tab === "alerts" && <AlertsTab can={can} />}
      {tab === "forecast" && <ForecastTab />}
      {tab === "settings" && <SettingsTab can={can} />}
      {tab === "audit" && <AuditTab />}
    </div>
  );
}

function KpisTab({ can }: { can: Can }) {
  const { show } = useToast();
  const { data, error, loading, reload } = useApi<{ items: KpiRow[] }>("/api/admin/analytics/kpis");
  const act2 = async (id: string, body: Record<string, unknown>, ok: string) => { if (await act(show, `/api/admin/analytics/kpis/${id}`, "PATCH", body, ok)) reload(); };
  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? "Could not load."} />;
  return (
    <Card title="KPI definitions" action={can("analytics:kpi:create") ? <Button size="sm" variant="outline" onClick={async () => { if (await act(show, "/api/admin/analytics/kpis", "POST", { action: "INSTALL_DEFAULTS" }, "Standard KPIs installed as drafts.")) reload(); }}>Install standard KPIs</Button> : undefined}>
      {data.items.length === 0 ? <EmptyState title="No KPIs yet" description="Install the standard set, review it, set your own targets and activate it." /> : (
        <ul className="divide-y divide-border text-sm">
          {data.items.map((k) => (
            <li key={k.id} className="space-y-1 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{k.name} <span className="text-xs text-muted">{k.code} · {k.formula} · v{k.version} · {k.frequency.toLowerCase()}</span></span><span className="flex items-center gap-2"><StatusBadge status={k.status} /><StatusBadge status={k.state === "NOT_AVAILABLE" ? "NOT_CONFIGURED" : k.state === "ON_TRACK" ? "PASS" : k.state === "ATTENTION_REQUIRED" ? "WARN" : "CRITICAL"} /></span></div>
              <p className="text-xs text-muted">{k.value === null ? "Insufficient verified data" : `${k.value}${k.unit === "PERCENT" ? "%" : ""}`}{k.target ? ` · target ${k.target.value}` : " · no target set"}</p>
              <div className="flex flex-wrap gap-2">
                {k.status === "DRAFT" && can("analytics:kpi:create") && <Button size="sm" variant="outline" onClick={() => { const r = window.prompt("Reason"); if (r) void act2(k.id, { action: "SUBMIT", reason: r }, "Submitted."); }}>Submit for review</Button>}
                {k.status === "UNDER_REVIEW" && can("analytics:kpi:manage") && <Button size="sm" variant="outline" onClick={() => { const r = window.prompt("Reason"); if (r) void act2(k.id, { action: "APPROVE", reason: r }, "Approved."); }}>Approve</Button>}
                {k.status === "APPROVED" && can("analytics:kpi:manage") && <Button size="sm" onClick={() => { const r = window.prompt("Reason"); if (r) void act2(k.id, { action: "ACTIVATE", reason: r }, "Activated."); }}>Activate</Button>}
                {can("analytics:kpi:manage") && <Button size="sm" variant="outline" onClick={() => { const t = window.prompt(`Target for ${k.name} (a number)`); if (t === null || t === "" || Number.isNaN(Number(t))) return; const w = window.prompt("Warning threshold (optional)"); const c = window.prompt("Critical threshold (optional)"); void act2(k.id, { action: "TARGET", frequency: k.frequency, targetValue: Number(t), warningThreshold: w ? Number(w) : null, criticalThreshold: c ? Number(c) : null }, "Target saved."); }}>Set target</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function QualityTab({ can }: { can: Can }) {
  const { show } = useToast();
  const { data, error, loading, reload } = useApi<{ summary: Array<{ status: string; severity: string; count: number }>; items: Issue[] }>("/api/admin/analytics/data-quality");
  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? "Could not load."} />;
  return (
    <Card title="Data-quality issues" action={can("analytics:data_quality:manage") ? <Button size="sm" variant="outline" onClick={async () => { if (await act(show, "/api/admin/analytics/data-quality", "POST", {}, "Checks finished.")) reload(); }}>Run checks now</Button> : undefined}>
      <p className="mb-2 text-xs text-muted">Issues name opaque record ids only. An issue that is no longer found resolves itself; ignoring one needs a reason.</p>
      {data.items.length === 0 ? <EmptyState title="No issues" description="Either nothing is wrong or the checks have not run yet." /> : (
        <ul className="divide-y divide-border text-sm">
          {data.items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div><p>{i.label}</p><p className="text-xs text-muted">{i.subjectType} {i.subjectRef} · {timeAgo(i.detectedAt)}{i.ignoreReason ? ` · ignored: ${i.ignoreReason}` : ""}</p></div>
              <div className="flex items-center gap-2"><StatusBadge status={i.severity} /><StatusBadge status={i.status} />
                {can("analytics:data_quality:manage") && i.status !== "RESOLVED" && <>
                  <Button size="sm" variant="outline" onClick={async () => { if (await act(show, `/api/admin/analytics/data-quality/${i.id}`, "PATCH", { status: "INVESTIGATING" }, "Marked investigating.")) reload(); }}>Investigate</Button>
                  <Button size="sm" variant="outline" onClick={async () => { const r = window.prompt("Reason for ignoring this issue"); if (r && (await act(show, `/api/admin/analytics/data-quality/${i.id}`, "PATCH", { status: "IGNORED_WITH_REASON", reason: r }, "Ignored with a reason."))) reload(); }}>Ignore…</Button>
                </>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ReconTab({ can }: { can: Can }) {
  const { show } = useToast();
  const { data, error, loading, reload } = useApi<{ latest: Recon | null }>("/api/admin/analytics/reconciliation");
  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? "Could not load."} />;
  const l = data.latest;
  return (
    <Card title="Reconciliation" action={can("analytics:reconciliation:manage") ? <Button size="sm" variant="outline" onClick={async () => { if (await act(show, "/api/admin/analytics/reconciliation", "POST", {}, "Reconciliation finished.")) reload(); }}>Run now</Button> : undefined}>
      {!l ? <EmptyState title="Not run yet" description="Compares the source tables with each metric's calculation and its stored daily figures." /> : (
        <div className="space-y-2 text-sm">
          <p>Last checked {timeAgo(l.startedAt)} for {String(l.rangeFrom).slice(0, 10)} to {String(l.rangeTo).slice(0, 10)}: <strong>{l.reconciled} reconciled</strong>, <strong>{l.variances} with a variance</strong>.</p>
          <div className="overflow-x-auto"><table className="w-full min-w-[560px]"><thead><tr className="text-muted"><th className="text-start font-medium">Figure</th><th className="text-start font-medium">Source</th><th className="text-start font-medium">Analytics</th><th className="text-start font-medium">Variance</th><th className="text-start font-medium">Result</th></tr></thead>
            <tbody>{l.items.map((i, n) => <tr key={n} className="border-t border-border"><td>{i.label}{i.currency ? ` (${i.currency})` : ""}</td><td>{i.operational.toLocaleString()}</td><td>{i.analytics.toLocaleString()}</td><td>{i.variance.toLocaleString()}</td><td><StatusBadge status={i.status === "RECONCILED" ? "PASS" : "WARN"} />{i.note ? <span className="ms-2 text-xs text-muted">{i.note}</span> : null}</td></tr>)}</tbody></table></div>
        </div>
      )}
    </Card>
  );
}

function PipelineTab({ can }: { can: Can }) {
  const { show } = useToast();
  const { data, error, loading, reload } = useApi<{ enabled: boolean; storedRows: number; marts: Array<{ key: string; status: string; lastRefreshedAt: string | null; lastCoveredDate: string | null; lastError: string | null }>; runs: Array<{ id: string; kind: string; status: string; startedAt: string; metricsComputed: number; rowsWritten: number; error: string | null }> }>("/api/admin/analytics/pipeline");
  const [f, setF] = useState({ martKey: "", fromDay: "", toDay: "", reason: "" });
  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? "Could not load."} />;
  return (
    <div className="space-y-4">
      <Card title="Data marts" action={can("analytics:pipeline:manage") ? <Button size="sm" variant="outline" onClick={async () => { if (await act(show, "/api/admin/analytics/pipeline", "POST", {}, "Refresh finished.")) reload(); }}>Refresh now</Button> : undefined}>
        <p className="mb-2 text-xs text-muted">Derived data only: every row can be rebuilt from the operational tables, which are never written. {data.enabled ? "" : "The pipeline switch (analytics.pipeline.enabled) is off."} {data.storedRows.toLocaleString()} stored daily rows.</p>
        {data.marts.length === 0 ? <EmptyState title="Never refreshed" /> : <ul className="divide-y divide-border text-sm">{data.marts.map((m) => <li key={m.key} className="flex flex-wrap justify-between gap-2 py-2"><span>{m.key}</span><span className="text-xs text-muted">covered to {m.lastCoveredDate ?? "—"} · refreshed {timeAgo(m.lastRefreshedAt)}{m.lastError ? ` · ${m.lastError}` : ""} <StatusBadge status={m.status} /></span></li>)}</ul>}
      </Card>
      {can("analytics:pipeline:manage") && (
        <Card title="Rebuild from source">
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Mart (section)"><Input value={f.martKey} onChange={(e) => setF({ ...f, martKey: e.target.value })} placeholder="e.g. support" /></Field>
            <Field label="From"><Input type="date" value={f.fromDay} onChange={(e) => setF({ ...f, fromDay: e.target.value })} /></Field>
            <Field label="To"><Input type="date" value={f.toDay} onChange={(e) => setF({ ...f, toDay: e.target.value })} /></Field>
            <Field label="Reason"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
          </div>
          <Button className="mt-3" size="sm" disabled={!f.martKey || !f.fromDay || !f.toDay || f.reason.trim().length < 3} onClick={async () => { if (await act(show, "/api/admin/analytics/rebuild", "POST", f, "Rebuild queued; it runs as a background job.")) reload(); }}>Queue rebuild</Button>
        </Card>
      )}
      <Card title="Recent runs">{data.runs.length === 0 ? <p className="text-sm text-muted">None yet.</p> : <ul className="divide-y divide-border text-sm">{data.runs.map((r) => <li key={r.id} className="flex flex-wrap justify-between gap-2 py-1.5"><span>{r.kind.toLowerCase()} · {r.metricsComputed} metrics · {r.rowsWritten} rows</span><span className="text-xs text-muted">{timeAgo(r.startedAt)} <StatusBadge status={r.status} />{r.error ? ` ${r.error}` : ""}</span></li>)}</ul>}</Card>
    </div>
  );
}

function AlertsTab({ can }: { can: Can }) {
  const { show } = useToast();
  const { data, error, loading, reload } = useApi<{ rules: Array<{ id: string; name: string; metricKey: string; operator: string; threshold: number; minSample: number; severity: string; status: string; cooldownMinutes: number }>; events: Array<{ id: string; ruleName: string; severity: string; status: string; message: string; sample: number; createdAt: string }> }>("/api/admin/analytics/alerts");
  const { data: cat } = useCatalog();
  const [f, setF] = useState({ name: "", metricKey: "finance.payment_failure_rate", operator: "GT", threshold: "15", minSample: "50", severity: "WARNING" });
  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? "Could not load."} />;
  return (
    <div className="space-y-4">
      <Card title="Open and recent alerts">
        {data.events.length === 0 ? <p className="text-sm text-muted">No alerts.</p> : <ul className="divide-y divide-border text-sm">{data.events.map((e) => <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><div><p>{e.message}</p><p className="text-xs text-muted">Based on {e.sample} · {timeAgo(e.createdAt)}</p></div><div className="flex items-center gap-2"><StatusBadge status={e.severity} /><StatusBadge status={e.status} />{can("analytics:alerts:manage") && e.status !== "RESOLVED" && <Button size="sm" variant="outline" onClick={async () => { if (await act(show, `/api/admin/analytics/alerts/${e.id}`, "PATCH", { resolve: true }, "Resolved.")) reload(); }}>Resolve</Button>}</div></li>)}</ul>}
      </Card>
      <Card title="Alert rules">
        <p className="mb-2 text-xs text-muted">A rule never fires on a sample smaller than its minimum, is not repeated while an alert is open, and stays quiet for its cooldown. The window is rounded up to whole days because figures refresh daily.</p>
        <ul className="divide-y divide-border text-sm">{data.rules.map((r) => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span>{r.name} <span className="text-xs text-muted">{r.metricKey} {r.operator} {r.threshold} · min sample {r.minSample}</span></span><span className="flex items-center gap-2"><StatusBadge status={r.severity} /><StatusBadge status={r.status} />{can("analytics:alerts:manage") && <Button size="sm" variant="outline" onClick={async () => { if (await act(show, `/api/admin/analytics/alerts/${r.id}`, "PATCH", { rule: true, status: r.status === "ACTIVE" ? "PAUSED" : "ACTIVE" }, "Updated.")) reload(); }}>{r.status === "ACTIVE" ? "Pause" : "Resume"}</Button>}</span></li>)}</ul>
      </Card>
      {can("analytics:alerts:manage") && (
        <Card title="New rule">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Metric"><Select value={f.metricKey} onChange={(e) => setF({ ...f, metricKey: e.target.value })}>{(cat?.items ?? []).filter((m) => !m.restricted && m.kind === "PERIOD" && !m.liveOnly).map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}</Select></Field>
            <Field label="Alert when"><Select value={f.operator} onChange={(e) => setF({ ...f, operator: e.target.value })}><option value="GT">is above</option><option value="GTE">is at or above</option><option value="LT">is below</option><option value="LTE">is at or below</option></Select></Field>
            <Field label="Threshold"><Input type="number" value={f.threshold} onChange={(e) => setF({ ...f, threshold: e.target.value })} /></Field>
            <Field label="Minimum sample"><Input type="number" value={f.minSample} onChange={(e) => setF({ ...f, minSample: e.target.value })} /></Field>
            <Field label="Severity"><Select value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}><option>INFO</option><option>WARNING</option><option>CRITICAL</option></Select></Field>
          </div>
          <Button className="mt-3" size="sm" disabled={f.name.trim().length < 3} onClick={async () => { if (await act(show, "/api/admin/analytics/alerts", "POST", { name: f.name, metricKey: f.metricKey, operator: f.operator, threshold: Number(f.threshold), minSample: Number(f.minSample), severity: f.severity, windowHours: 24 }, "Rule created (you will not be notified unless you add recipients later).")) { setF({ ...f, name: "" }); reload(); } }}>Create rule</Button>
        </Card>
      )}
    </div>
  );
}

function ForecastTab() {
  const [metric, setMetric] = useState("applicants.new");
  const { data, error, loading } = useApi<{ ok: boolean; message?: string; model?: string; historyDays?: number; horizonDays?: number; points?: Array<{ day: string; estimate: number; low: number; high: number }>; assumptions?: string[]; limitations?: string[] }>(`/api/admin/analytics/forecast?metric=${metric}`);
  return (
    <div className="space-y-3">
      <Field label="Forecast"><Select value={metric} onChange={(e) => setMetric(e.target.value)} className="w-72">{[["applicants.new", "New applicants"], ["funnel.leads", "Leads"], ["support.opened", "Support cases"], ["membership.renewals_completed", "Renewals"], ["finance.gross_revenue", "Gross revenue"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
      {loading ? <Loading /> : error || !data ? <ErrorNote message={error ?? "Could not load."} /> : !data.ok ? <EmptyState title="Insufficient verified data" description={data.message} /> : (
        <>
          <LineAreaChart title={`Estimate: next ${data.horizonDays} days`} points={(data.points ?? []).map((p) => ({ day: p.day, value: p.estimate }))} />
          <Card title="How to read this">
            <p className="text-sm">Model: {data.model}. Built from {data.historyDays} days of history. Approximate range for the last day: {data.points?.[data.points.length - 1]?.low} to {data.points?.[data.points.length - 1]?.high}.</p>
            <p className="mt-2 text-sm font-medium">Assumptions</p><ul className="list-disc ps-5 text-sm">{data.assumptions?.map((a, i) => <li key={i}>{a}</li>)}</ul>
            <p className="mt-2 text-sm font-medium">Limitations</p><ul className="list-disc ps-5 text-sm">{data.limitations?.map((a, i) => <li key={i}>{a}</li>)}</ul>
          </Card>
        </>
      )}
    </div>
  );
}

function SettingsTab({ can }: { can: Can }) {
  const { show } = useToast();
  const { data, error, loading, reload } = useApi<{ timezone: string; minGroupSize: number; freshnessSlaHours: number; activeEvents: string[]; activeDefinition: string }>("/api/admin/analytics/settings");
  const [edit, setEdit] = useState<{ timezone?: string; minGroupSize?: number; freshnessSlaHours?: number }>({});
  const [reason, setReason] = useState("");
  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? "Could not load."} />;
  const editable = can("analytics:manage");
  return (
    <Card title="Settings">
      <p className="mb-3 text-sm text-muted">{data.activeDefinition} Qualifying actions now: {data.activeEvents.join(", ").toLowerCase().replace(/_/g, " ")}.</p>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Business timezone"><Input disabled={!editable} value={edit.timezone ?? data.timezone} onChange={(e) => setEdit({ ...edit, timezone: e.target.value })} /></Field>
        <Field label="Smallest group a breakdown may show"><Input type="number" disabled={!editable} value={edit.minGroupSize ?? data.minGroupSize} onChange={(e) => setEdit({ ...edit, minGroupSize: Number(e.target.value) })} /></Field>
        <Field label="Data counts as stale after (hours)"><Input type="number" disabled={!editable} value={edit.freshnessSlaHours ?? data.freshnessSlaHours} onChange={(e) => setEdit({ ...edit, freshnessSlaHours: Number(e.target.value) })} /></Field>
      </div>
      {editable && <><Field label="Reason for the change" className="mt-3"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field><Button className="mt-3" size="sm" disabled={!Object.keys(edit).length || reason.trim().length < 3} onClick={async () => { if (await act(show, "/api/admin/analytics/settings", "PATCH", { ...edit, reason }, "Settings saved.")) { setEdit({}); setReason(""); reload(); } }}>Save</Button></>}
    </Card>
  );
}

function AuditTab() {
  const [kind, setKind] = useState("changes");
  const { data, error, loading } = useApi<{ items: Array<{ id: string; action: string; adminId: string | null; resource?: string; createdAt: string }> }>(`/api/admin/analytics/audit?kind=${kind}`);
  return (
    <Card title="Audit trail" action={<Select value={kind} onChange={(e) => setKind(e.target.value)} className="w-40"><option value="changes">Changes</option><option value="access">Access (reads)</option></Select>}>
      {loading ? <Loading /> : error || !data ? <ErrorNote message={error ?? "Could not load."} /> : data.items.length === 0 ? <p className="text-sm text-muted">Nothing recorded yet.</p> : <ul className="divide-y divide-border text-sm">{data.items.map((a) => <li key={a.id} className="flex justify-between gap-2 py-1.5"><span>{a.action.replace(/^ANALYTICS_/, "").replace(/_/g, " ").toLowerCase()}{a.resource ? ` — ${a.resource}` : ""}</span><span className="text-xs text-muted">{timeAgo(a.createdAt)}</span></li>)}</ul>}
    </Card>
  );
}

// ---------------------------------------------------------------- Dashboard builder
const WIDGET_TYPES = ["KPI", "LINE", "AREA", "BAR", "PIE", "FUNNEL", "TABLE"];
interface W { id: string; type: string; title: string; metrics: string[]; dimension?: string }
interface Rendered { id: string; name: string; description: string | null; freshness: Freshness | null; period: { label: string } | null; widgets: Array<{ id: string; type: string; title: string; available: boolean; reason?: string; result?: MetricResult[]; series?: { available: boolean; points: Array<{ day: string; value: number }> } }> }

export function DashboardBuilderClient({ permissions }: { permissions: string[] }) {
  const can: Can = (p) => permissions.includes(p);
  const { show } = useToast();
  const list = useApi<{ items: Array<{ id: string; code: string; name: string; owner: boolean; status: string; version: number }> }>("/api/admin/analytics/dashboards");
  const cat = useCatalog();
  const [name, setName] = useState("");
  const [widgets, setWidgets] = useState<W[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const view = useApi<Rendered>(open ? `/api/admin/analytics/dashboards/${open}` : null);
  const [draft, setDraft] = useState<W>({ id: "w1", type: "KPI", title: "", metrics: [], dimension: "" });
  const metric = cat.data?.items.find((m) => m.key === draft.metrics[0]);
  const usable = (cat.data?.items ?? []).filter((m) => !m.restricted);
  function addWidget() {
    if (draft.title.trim().length < 3 || draft.metrics.length === 0) return show("Give the widget a title and choose a metric.", "error");
    setWidgets([...widgets, { ...draft, id: `w${widgets.length + 1}`, dimension: draft.dimension || undefined }]);
    setDraft({ id: "", type: "KPI", title: "", metrics: [], dimension: "" });
  }
  async function save() {
    if (await act(show, "/api/admin/analytics/dashboards", "POST", { name, widgets }, "Dashboard saved.")) { setName(""); setWidgets([]); list.reload(); }
  }
  return (
    <div className="space-y-4">
      <div><Link href="/admin/analytics" className="text-sm text-primary hover:underline">← Analytics</Link><h1 className="mt-1 text-xl font-semibold">Dashboard builder</h1>
        <p className="text-sm text-muted">Pick catalog metrics, a chart type and an optional breakdown. Dashboards hold structured widgets only (never SQL). When someone opens a shared dashboard, each widget is checked against THEIR access.</p></div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Your dashboards">
          {list.loading ? <Loading /> : list.error || !list.data ? <NotOn2 message={list.error ?? "Could not load."} /> : list.data.items.length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
            <ul className="divide-y divide-border text-sm">{list.data.items.map((d) => <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><button type="button" className="text-primary hover:underline" onClick={() => setOpen(d.id)}>{d.name}</button><span className="text-xs text-muted">{d.code} · v{d.version}{d.owner ? " · yours" : " · shared"}{d.owner && can("analytics:dashboard:share") && <button type="button" className="ms-2 text-primary hover:underline" onClick={async () => { const s = window.prompt("Share with: ORGANIZATION, TEAM (a role name), DEPARTMENT (a department id), or PRIVATE"); if (!s) return; const v = s === "TEAM" || s === "DEPARTMENT" ? window.prompt("Which role or department id?") ?? "" : ""; if (await act(show, `/api/admin/analytics/dashboards/${d.id}/share`, "POST", { scope: s, scopeValue: v }, "Sharing updated.")) list.reload(); }}>Share…</button>}</span></li>)}</ul>
          )}
        </Card>
        {can("analytics:dashboard:create") && (
          <Card title="New dashboard">
            <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
            <ul className="my-2 space-y-1 text-sm">{widgets.map((w) => <li key={w.id} className="flex justify-between"><span>{w.title} <span className="text-xs text-muted">{w.type.toLowerCase()} · {w.metrics.join(", ")}{w.dimension ? ` by ${w.dimension}` : ""}</span></span><button type="button" className="text-xs text-danger" onClick={() => setWidgets(widgets.filter((x) => x.id !== w.id))}>Remove</button></li>)}</ul>
            <div className="grid gap-2 md:grid-cols-2">
              <Field label="Widget title"><Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={80} /></Field>
              <Field label="Chart"><Select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>{WIDGET_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
              <Field label="Metric"><Select value={draft.metrics[0] ?? ""} onChange={(e) => setDraft({ ...draft, metrics: e.target.value ? [e.target.value] : [], dimension: "" })}><option value="">Choose…</option>{usable.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}</Select></Field>
              <Field label="Breakdown (optional)"><Select value={draft.dimension ?? ""} onChange={(e) => setDraft({ ...draft, dimension: e.target.value })}><option value="">None</option>{(metric?.dimensions ?? []).map((d) => <option key={d} value={d}>{d.replace(/_/g, " ")}</option>)}</Select></Field>
            </div>
            <div className="mt-3 flex gap-2"><Button size="sm" variant="outline" onClick={addWidget}>Add widget</Button><Button size="sm" onClick={save} disabled={name.trim().length < 3 || widgets.length === 0}>Save dashboard</Button></div>
          </Card>
        )}
      </div>
      {open && (view.loading ? <Loading /> : view.error || !view.data ? <ErrorNote message={view.error ?? "Could not load."} /> : (
        <div className="space-y-3">
          <div className="flex items-center justify-between"><h2 className="font-medium">{view.data.name}</h2><FreshnessBadge f={view.data.freshness} /></div>
          <div className="grid gap-3 lg:grid-cols-2">
            {view.data.widgets.map((w) => !w.available ? <div key={w.id} className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">{w.title}: {w.reason}</div> : w.type === "LINE" || w.type === "AREA" ? <LineAreaChart key={w.id} title={w.title} points={w.series?.points ?? []} area={w.type === "AREA"} /> : (w.type === "BAR" || w.type === "PIE") && w.result?.[0] ? <BreakdownChart key={w.id} r={w.result[0]} /> : w.type === "TABLE" ? <HBarChart key={w.id} title={w.title} data={(w.result ?? []).flatMap((r) => r.values.map((v) => ({ label: `${r.name}${v.dimensionValue !== "ALL" ? ` — ${v.dimensionValue}` : ""}`, value: v.display })))} /> : <div key={w.id} className="space-y-2">{(w.result ?? []).map((r) => <MetricCard key={r.key} r={r} period={view.data!.period?.label ?? ""} />)}</div>)}
          </div>
        </div>
      ))}
    </div>
  );
}

function NotOn2({ message }: { message: string }) {
  return <p className="text-sm text-muted">{/not switched on/i.test(message) ? "Analytics is not switched on yet." : message}</p>;
}

// ---------------------------------------------------------------- Report builder
const DATASETS = ["applicants", "crm", "marketing", "matching", "proposals", "meetings", "verification", "support", "membership", "finance", "engagement", "referrals", "workload"];
const PREFIX: Record<string, string[]> = {
  applicants: ["applicants.", "funnel.", "outcomes."], crm: ["crm."], marketing: ["marketing."], matching: ["matching."], proposals: ["proposals.", "outcomes."], meetings: ["meetings."],
  verification: ["verification.", "identity.", "applicants.verifications_completed"], support: ["support."], membership: ["membership."], finance: ["finance."], engagement: ["engagement."],
  referrals: ["engagement.referrals", "membership.referral"], workload: ["tasks.", "followups.", "crm.assignment"],
};
interface Table { title: string; columns: Array<{ key: string; label: string }>; rows: Array<Record<string, unknown>>; footnotes: string[] }

export function ReportBuilderClient({ permissions }: { permissions: string[] }) {
  const can: Can = (p) => permissions.includes(p);
  const { show } = useToast();
  const cat = useCatalog();
  const saved = useApi<{ items: Array<{ id: string; code: string; name: string; owner: boolean; version: number; schedules?: Array<{ id: string; frequency: string; status: string }> }> }>("/api/admin/analytics/reports");
  const [dataset, setDataset] = useState("applicants");
  const [metrics, setMetrics] = useState<string[]>([]);
  const [dimension, setDimension] = useState("");
  const [w, setW] = useState({ period: "LAST_30_DAYS", compare: "PREVIOUS_PERIOD", from: "", to: "" });
  const [name, setName] = useState("");
  const [table, setTable] = useState<Table | null>(null);
  const [fresh, setFresh] = useState<Freshness | null>(null);
  const [busy, setBusy] = useState(false);
  const available = (cat.data?.items ?? []).filter((m) => !m.restricted && PREFIX[dataset].some((p) => m.key.startsWith(p)));
  const dims = [...new Set(available.filter((m) => metrics.includes(m.key)).flatMap((m) => m.dimensions))].filter((d) => available.filter((m) => metrics.includes(m.key)).every((m) => m.dimensions.includes(d)));
  const definition = () => ({ dataset, query: { metrics, period: { preset: w.period, ...(w.period === "CUSTOM" ? { from: w.from, to: w.to } : {}) }, compare: w.compare, ...(dimension ? { dimension } : {}) } });

  async function preview() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/analytics/reports/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ definition: definition() }) });
      const j = (await res.json().catch(() => ({}))) as { table?: Table; freshness?: Freshness; error?: string };
      if (!res.ok) show(j.error ?? "Could not run the report.", "error");
      else { setTable(j.table ?? null); setFresh(j.freshness ?? null); }
    } finally { setBusy(false); }
  }
  async function download(format: string, id?: string) {
    const res = await fetch(id ? `/api/admin/analytics/reports/${id}/export` : "/api/admin/analytics/reports/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(id ? { format } : { format, definition: definition() }) });
    if (!res.ok) return show(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Export failed.", "error");
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? `report.${format}`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  async function save() {
    if (await act(show, "/api/admin/analytics/reports", "POST", { name, definition: definition(), visibility: "PRIVATE" }, "Report saved.")) { setName(""); saved.reload(); }
  }
  return (
    <div className="space-y-4">
      <div><Link href="/admin/analytics" className="text-sm text-primary hover:underline">← Analytics</Link><h1 className="mt-1 text-xl font-semibold">Report builder</h1>
        <p className="text-sm text-muted">Choose a dataset, the metrics, an optional breakdown and a period. Reports run as the person opening them; exports are audited and carry the definitions.</p></div>
      <Card title="Build">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Dataset"><Select value={dataset} onChange={(e) => { setDataset(e.target.value); setMetrics([]); setDimension(""); }}>{DATASETS.map((d) => <option key={d} value={d}>{d}</option>)}</Select></Field>
          <Field label="Breakdown"><Select value={dimension} onChange={(e) => setDimension(e.target.value)}><option value="">None</option>{dims.map((d) => <option key={d} value={d}>{d.replace(/_/g, " ")}</option>)}</Select></Field>
        </div>
        <fieldset className="mt-3"><legend className="mb-1 text-sm font-medium">Metrics</legend>
          <div className="grid gap-1 sm:grid-cols-2">{available.map((m) => <label key={m.key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={metrics.includes(m.key)} onChange={(e) => setMetrics(e.target.checked ? [...metrics, m.key].slice(0, 12) : metrics.filter((x) => x !== m.key))} />{m.name}</label>)}</div>
          {available.length === 0 && <p className="text-sm text-muted">No metrics in this dataset are available to you.</p>}
        </fieldset>
        <div className="mt-3"><PeriodBar {...w} onChange={setW} /></div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={preview} disabled={busy || metrics.length === 0}>{busy ? "Running…" : "Preview"}</Button>
          {can("analytics:reports:export") && ["csv", "xlsx", "pdf"].map((f) => <Button key={f} size="sm" variant="outline" disabled={metrics.length === 0} onClick={() => download(f)}>Download {f.toUpperCase()}</Button>)}
        </div>
      </Card>
      {table && (
        <Card title="Result">
          <FreshnessBadge f={fresh} />
          <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[480px] text-sm"><thead><tr>{table.columns.map((c) => <th key={c.key} className="border-b border-border px-2 py-1 text-start font-medium text-muted">{c.label}</th>)}</tr></thead>
            <tbody>{table.rows.map((r, i) => <tr key={i}>{table.columns.map((c) => <td key={c.key} className="border-b border-border/50 px-2 py-1">{String(r[c.key] ?? "")}</td>)}</tr>)}</tbody></table></div>
          <ul className="mt-2 list-disc ps-5 text-xs text-muted">{table.footnotes.map((f, i) => <li key={i}>{f}</li>)}</ul>
          {can("analytics:reports:create") && <div className="mt-3 flex flex-wrap items-end gap-2"><Field label="Save as"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field><Button size="sm" variant="outline" disabled={name.trim().length < 3} onClick={save}>Save report</Button></div>}
        </Card>
      )}
      <Card title="Saved reports">
        {saved.loading ? <Loading /> : saved.error || !saved.data ? <NotOn2 message={saved.error ?? "Could not load."} /> : saved.data.items.length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
          <ul className="divide-y divide-border text-sm">{saved.data.items.map((r) => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span>{r.name} <span className="text-xs text-muted">{r.code} · v{r.version}{r.owner ? "" : " · shared"}</span></span>
            <span className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={async () => { const res = await fetch(`/api/admin/analytics/reports/${r.id}/run`, { method: "POST" }); const j = (await res.json().catch(() => ({}))) as { table?: Table; freshness?: Freshness; error?: string }; if (!res.ok) show(j.error ?? "Could not run.", "error"); else { setTable(j.table ?? null); setFresh(j.freshness ?? null); } }}>Run</Button>
              {can("analytics:reports:export") && <Button size="sm" variant="outline" onClick={() => download("csv", r.id)}>CSV</Button>}
              {r.owner && can("analytics:reports:schedule") && <Button size="sm" variant="outline" onClick={async () => { const ids = window.prompt("Recipient admin ids, comma separated (each must still have access)"); if (!ids) return; const f = window.prompt("DAILY, WEEKLY or MONTHLY", "WEEKLY"); if (!f) return; await act(show, `/api/admin/analytics/reports/${r.id}/schedule`, "POST", { frequency: f.toUpperCase(), recipientAdminIds: ids.split(",").map((x) => x.trim()).filter(Boolean) }, "Scheduled. Recipients are re-checked before every delivery."); saved.reload(); }}>Schedule…</Button>}
            </span></li>)}</ul>
        )}
      </Card>
    </div>
  );
}
