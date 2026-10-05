"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { BarChart } from "@/components/admin/bar-chart";
import { Card, ErrorNote, Loading, StatusBadge, useApi } from "@/components/admin/system/shared";
import { FindingsList, RoiNote, act, money, type PolicyFinding } from "@/components/admin/marketing/shared";
import { formatDateTime, formatEnumLabel } from "@/lib/utils";

// Admin -> Marketing -> Campaign. Every control mirrors what the viewer may do; the server re-checks each action, the
// governance checks (approver != author, content hash, published page/form, budget, provider) and the STEP 19 gate.

type Can = (p: string) => boolean;

interface CampaignDto {
  id: string; code: string; name: string; description: string | null; objective: string; channel: string; status: string; providerKey: string;
  campaignKey: string; utmSource: string | null; utmMedium: string | null; startAt: string | null; endAt: string | null; language: string;
  landingPageId: string | null; formId: string | null; attributionModel: string | null; notes: string | null; createdById: string; submittedById: string | null;
  approvedById: string | null; approvedAt: string | null; launchedAt: string | null; pausedReason: string | null;
  budget: { currencyCode: string; totalMinor: number | null; dailyMinor: number | null; alertThresholdPct: number | null; spendVerified: boolean; spendVerifiedMinor: number | null; remainingMinor: number | null } | null;
}
interface Detail {
  campaign: CampaignDto;
  adNodes: Array<{ id: string; level: string; name: string; status: string; parentId: string | null }>;
  creatives: Array<{ id: string; code: string; name: string; status: string; headline: string }>;
  budgetEvents: Array<{ id: string; type: string; amountMinor: number | null; reason: string | null; createdAt: string }>;
  landingPage: { id: string; code: string; slug: string; name: string; status: string } | null;
  form: { id: string; code: string; name: string; status: string } | null;
  launchChecklist: { ok: boolean; failures: string[] };
  policyScan: { pass: boolean; findings: PolicyFinding[]; disclaimer: string };
}
interface CampaignAnalytics {
  analytics: { funnel: { stages: Array<{ key: string; label: string; value: number; source: string }>; note: string }; advertising: { hasData: boolean } };
  attribution: Array<{ verification: string; count: number }>;
  roi: { status: string; message?: string; roiPct?: number; spendMinor?: number; revenueMinor?: number; methodology?: string };
}

export function CampaignDetailClient({ id, permissions, initialTab }: { id: string; permissions: string[]; initialTab?: string }) {
  const can: Can = (p) => permissions.includes(p);
  const { data, error, loading, reload } = useApi<Detail>(`/api/admin/marketing/campaigns/${id}`);
  const tabs = [
    { value: "overview", label: "Overview" },
    { value: "assets", label: "Page, form & creatives" },
    { value: "ads", label: "Ads" },
    ...(can("marketing:leads:view") ? [{ value: "leads", label: "Leads" }] : []),
    ...(can("marketing:analytics:view") ? [{ value: "analytics", label: "Analytics & attribution" }] : []),
    ...(can("marketing:budget:view") ? [{ value: "budget", label: "Budget" }] : []),
  ];
  const [tab, setTab] = useState(tabs.some((t) => t.value === initialTab) ? (initialTab as string) : "overview");

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? "Campaign not found."} />;
  const c = data.campaign;

  return (
    <div className="space-y-4">
      <div>
        <Link href="/admin/marketing" className="text-sm text-primary hover:underline">← Marketing Center</Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{c.name}</h1>
          <StatusBadge status={c.status} />
          <span className="font-mono text-xs text-muted">{c.code}</span>
        </div>
        <p className="text-sm text-muted">{formatEnumLabel(c.objective)} · {formatEnumLabel(c.channel)} · {formatEnumLabel(c.providerKey)}</p>
      </div>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === "overview" && <OverviewPanel d={data} can={can} reload={reload} />}
      {tab === "assets" && <AssetsPanel d={data} />}
      {tab === "ads" && <AdsPanel d={data} />}
      {tab === "leads" && <LeadsPanel id={id} />}
      {tab === "analytics" && <AnalyticsPanel id={id} />}
      {tab === "budget" && <BudgetPanel d={data} can={can} reload={reload} />}
    </div>
  );
}

// ------------------------------------------------------------------ Overview + lifecycle
function OverviewPanel({ d, can, reload }: { d: Detail; can: Can; reload: () => void }) {
  const { show } = useToast();
  const c = d.campaign;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function run(path: string, body: Record<string, unknown>, msg: string, needsReason = true) {
    if (needsReason && !note.trim()) { show("Please add a short reason first.", "error"); return; }
    setBusy(true);
    const ok = await act(show, `/api/admin/marketing/campaigns/${c.id}/${path}`, "POST", body, msg);
    setBusy(false);
    if (ok) { setNote(""); reload(); }
  }
  const reasonBody = { reason: note.trim() };
  const s = c.status;

  return (
    <div className="space-y-3">
      <Card title="Launch checklist">
        {d.launchChecklist.ok ? <p className="text-sm text-success">All launch checks currently pass.</p> : (
          <ul className="list-disc space-y-1 ps-5 text-sm text-danger">{d.launchChecklist.failures.map((f, i) => <li key={i}>{f}</li>)}</ul>
        )}
        <p className="mt-2 text-xs text-muted">Launching also needs an approver who is not the author, and — for the campaign launch itself — an independent approval from the approvals queue.</p>
      </Card>
      <Card title="Content policy check">
        <FindingsList findings={d.policyScan.findings} />
        <p className="mt-2 text-xs text-muted">{d.policyScan.disclaimer}</p>
      </Card>
      <Card title="Lifecycle">
        <div className="space-y-3">
          <Field label="Reason / note (required for most actions)"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></Field>
          <div className="flex flex-wrap gap-2">
            {s === "DRAFT" && can("marketing:edit") && <Button disabled={busy} onClick={() => run("submit-review", {}, "Submitted for review.", false)}>Submit for review</Button>}
            {s === "IN_REVIEW" && can("marketing:approve") && <Button disabled={busy} onClick={() => run("approve", { note: note.trim() || undefined }, "Campaign approved.", false)}>Approve</Button>}
            {s === "IN_REVIEW" && can("marketing:approve") && <Button variant="outline" disabled={busy} onClick={() => run("reject", reasonBody, "Campaign sent back to draft.")}>Reject</Button>}
            {(s === "APPROVED" || s === "SCHEDULED") && can("marketing:launch") && <Button disabled={busy} onClick={() => run("launch", reasonBody, "Launch processed.")}>Launch</Button>}
            {s === "PAUSED" && can("marketing:launch") && <Button disabled={busy} onClick={() => run("resume", reasonBody, "Campaign resumed.")}>Resume</Button>}
            {s === "ACTIVE" && can("marketing:pause") && <Button variant="outline" disabled={busy} onClick={() => run("pause", reasonBody, "Campaign paused.")}>Pause</Button>}
            {(s === "ACTIVE" || s === "PAUSED") && can("marketing:pause") && <Button variant="outline" disabled={busy} onClick={() => run("complete", reasonBody, "Campaign completed.")}>Complete</Button>}
            {(s === "DRAFT" || s === "COMPLETED") && can("marketing:archive") && <Button variant="danger" disabled={busy} onClick={() => run("archive", reasonBody, "Campaign archived.")}>Archive</Button>}
          </div>
          <p className="text-xs text-muted">Nothing here — and no automation or AI — can launch a campaign, spend money or raise a budget on its own. A campaign edited after approval returns to draft and must be reviewed again.</p>
        </div>
      </Card>
      <Card title="Details">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Row k="Campaign key" v={c.campaignKey} />
          <Row k="Language" v={c.language} />
          <Row k="UTM source / medium" v={`${c.utmSource ?? "—"} / ${c.utmMedium ?? "—"}`} />
          <Row k="Schedule" v={`${c.startAt ? formatDateTime(c.startAt) : "—"} → ${c.endAt ? formatDateTime(c.endAt) : "—"}`} />
          <Row k="Attribution model" v={c.attributionModel ? formatEnumLabel(c.attributionModel) : "Not set"} />
          <Row k="Approved" v={c.approvedAt ? formatDateTime(c.approvedAt) : "Not yet"} />
          <Row k="Launched" v={c.launchedAt ? formatDateTime(c.launchedAt) : "Not yet"} />
          {c.pausedReason && <Row k="Paused because" v={c.pausedReason} />}
        </dl>
        {c.description && <p className="mt-3 text-sm text-muted">{c.description}</p>}
      </Card>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-3 border-b border-border/60 pb-1"><dt className="text-muted">{k}</dt><dd className="text-end font-medium">{v}</dd></div>;
}

// ------------------------------------------------------------------ Assets
function AssetsPanel({ d }: { d: Detail }) {
  return (
    <div className="space-y-3">
      <Card title="Landing page">
        {d.landingPage ? (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>{d.landingPage.name} <span className="font-mono text-xs text-muted">/lp/{d.landingPage.slug}</span></span>
            <span className="flex items-center gap-3"><StatusBadge status={d.landingPage.status} /><Link className="text-primary hover:underline" href={`/admin/marketing/landing-pages/${d.landingPage.id}`}>Open editor</Link></span>
          </div>
        ) : <p className="text-sm text-muted">No landing page is linked yet.</p>}
      </Card>
      <Card title="Lead form">
        {d.form ? <div className="flex items-center justify-between text-sm"><span>{d.form.name} <span className="font-mono text-xs text-muted">{d.form.code}</span></span><StatusBadge status={d.form.status} /></div> : <p className="text-sm text-muted">No lead form is linked yet.</p>}
      </Card>
      <Card title="Creatives">
        {d.creatives.length === 0 ? <p className="text-sm text-muted">No creatives for this campaign.</p> : (
          <ul className="space-y-2 text-sm">{d.creatives.map((x) => <li key={x.id} className="flex items-center justify-between gap-2"><span>{x.name} <span className="text-muted">— {x.headline}</span></span><StatusBadge status={x.status} /></li>)}</ul>
        )}
      </Card>
    </div>
  );
}

function AdsPanel({ d }: { d: Detail }) {
  if (d.adNodes.length === 0) return <EmptyState title="No ad entries" description="Nothing has been created at an ad provider for this campaign." />;
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface p-3">
      <table className="w-full min-w-[480px] text-sm">
        <thead className="text-left text-xs text-muted"><tr><th className="pb-2">Name</th><th className="pb-2">Level</th><th className="pb-2">Status</th></tr></thead>
        <tbody>{d.adNodes.map((n) => <tr key={n.id} className="border-t border-border"><td className="py-2" style={{ paddingInlineStart: n.parentId ? 20 : 0 }}>{n.name}</td><td className="py-2">{formatEnumLabel(n.level)}</td><td className="py-2"><StatusBadge status={n.status} /></td></tr>)}</tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ Leads
interface LeadRow { id: string; leadCode: string; fullName: string; status: string; city: string | null; contactMasked: boolean; phone: string | null; capturedAt: string | null; createdAt: string }

function LeadsPanel({ id }: { id: string }) {
  const { data, error, loading } = useApi<{ items: LeadRow[] }>(`/api/admin/marketing/leads?campaignId=${encodeURIComponent(id)}&take=50`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote message={error} />;
  if (!data || data.items.length === 0) return <EmptyState title="No leads from this campaign yet" />;
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface p-3">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="text-left text-xs text-muted"><tr><th className="pb-2">Lead</th><th className="pb-2">Name</th><th className="pb-2">City</th><th className="pb-2">Status</th><th className="pb-2">Captured</th></tr></thead>
        <tbody>{data.items.map((l) => <tr key={l.id} className="border-t border-border"><td className="py-2"><Link className="text-primary hover:underline" href={`/admin/marketing/leads/${l.id}`}>{l.leadCode}</Link></td><td className="py-2">{l.fullName}</td><td className="py-2">{l.city ?? "—"}</td><td className="py-2"><StatusBadge status={l.status} /></td><td className="py-2 text-muted">{formatDateTime(l.capturedAt ?? l.createdAt)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ Analytics
function AnalyticsPanel({ id }: { id: string }) {
  const { data, error, loading } = useApi<CampaignAnalytics>(`/api/admin/marketing/campaigns/${id}/analytics`);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? "No data."} />;
  const stages = data.analytics.funnel.stages;
  return (
    <div className="space-y-3">
      <Card title="Funnel">
        <BarChart title="Provider-reported and internal counts (kept separate)" data={stages.map((f) => ({ label: `${f.label}${f.source === "provider" ? " (provider)" : ""}`, count: f.value }))} />
        <p className="mt-2 text-xs text-muted">{data.analytics.funnel.note}</p>
      </Card>
      <Card title="Attribution">
        {data.attribution.length === 0 ? <p className="text-sm text-muted">No attribution recorded.</p> : (
          <ul className="space-y-1 text-sm">{data.attribution.map((a) => <li key={a.verification} className="flex justify-between"><span>{formatEnumLabel(a.verification)}</span><strong>{a.count}</strong></li>)}</ul>
        )}
        <p className="mt-2 text-xs text-muted">Only verified touches count toward ROI.</p>
      </Card>
      <Card title="Return on investment">
        {data.roi.status === "CALCULATED" ? (
          <div className="space-y-1 text-sm"><p>ROI: <strong>{data.roi.roiPct}%</strong></p><p className="text-xs text-muted">{data.roi.methodology}</p></div>
        ) : <p className="text-sm">{data.roi.message ?? "Insufficient verified data for ROI calculation."}</p>}
        <RoiNote />
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ Budget
function BudgetPanel({ d, can, reload }: { d: Detail; can: Can; reload: () => void }) {
  const { show } = useToast();
  const b = d.campaign.budget;
  const [total, setTotal] = useState("");
  const [daily, setDaily] = useState("");
  const [reason, setReason] = useState("");
  if (!b) return <ErrorNote message="You do not have access to budget details." />;

  async function change() {
    const t = Math.round(Number(total) * 100);
    if (!Number.isFinite(t) || t < 0) { show("Enter a valid total budget.", "error"); return; }
    const body: Record<string, unknown> = { newTotalMinor: t, reason };
    if (daily.trim()) body.newDailyMinor = Math.round(Number(daily) * 100);
    if (await act(show, `/api/admin/marketing/campaigns/${d.campaign.id}/budget`, "POST", body, "Budget updated.")) { setTotal(""); setDaily(""); setReason(""); reload(); }
  }

  return (
    <div className="space-y-3">
      <Card title="Current budget">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Row k="Total" v={money(b.totalMinor, b.currencyCode)} />
          <Row k="Daily" v={money(b.dailyMinor, b.currencyCode)} />
          <Row k="Verified spend" v={b.spendVerified ? money(b.spendVerifiedMinor, b.currencyCode) : "Not verified"} />
          <Row k="Remaining" v={b.remainingMinor != null ? money(b.remainingMinor, b.currencyCode) : "Unknown"} />
        </dl>
        <p className="mt-2 text-xs text-muted">Spend is shown only when verified by the ad provider; sandbox figures never count.</p>
      </Card>
      {can("marketing:budget:manage") && (
        <Card title="Change budget">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={`New total (${b.currencyCode})`}><Input type="number" min={0} value={total} onChange={(e) => setTotal(e.target.value)} /></Field>
            <Field label={`New daily (${b.currencyCode}, optional)`}><Input type="number" min={0} value={daily} onChange={(e) => setDaily(e.target.value)} /></Field>
            <Field label="Reason" className="sm:col-span-2"><Textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          </div>
          <p className="mt-2 text-xs text-muted">On a launched campaign, an increase needs an independent approval and only applies once approved; decreases apply immediately.</p>
          <div className="mt-3"><Button onClick={change} disabled={!total || !reason.trim()}>Submit change</Button></div>
        </Card>
      )}
      <Card title="Budget history">
        {d.budgetEvents.length === 0 ? <p className="text-sm text-muted">No budget changes recorded.</p> : (
          <ul className="space-y-1 text-sm">{d.budgetEvents.map((e) => <li key={e.id} className="flex justify-between gap-2"><span>{formatEnumLabel(e.type)}{e.reason ? ` — ${e.reason}` : ""}</span><span className="text-muted">{e.amountMinor != null ? money(e.amountMinor, b.currencyCode) : ""} · {formatDateTime(e.createdAt)}</span></li>)}</ul>
        )}
      </Card>
    </div>
  );
}
