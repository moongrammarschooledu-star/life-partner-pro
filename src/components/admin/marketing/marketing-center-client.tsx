"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Tabs } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { BarChart } from "@/components/admin/bar-chart";
import { FunnelChart } from "@/components/admin/funnel-chart";
import { TrendChart } from "@/components/admin/trend-chart";
import { Card, ErrorNote, Loading, StatusBadge, useApi } from "@/components/admin/system/shared";
import { AiAssistantPanel } from "@/components/admin/marketing/ai-assistant-panel";
import { AdsTab, CreativesTab, FormsTab, LeadsTab } from "@/components/admin/marketing/tabs-content";
import { AuditTab, AutomationTab, ConsentTab, ExperimentsTab, ProvidersTab, SuppressionTab } from "@/components/admin/marketing/tabs-governance";
import { act, money } from "@/components/admin/marketing/shared";
import { formatEnumLabel } from "@/lib/utils";

// Admin -> Marketing Center. A shell over the STEP 29 APIs: every call enforces its own permission on the server; the tabs
// and buttons here only mirror what the viewer may do (a control the viewer cannot use is not rendered).

const OBJECTIVES = ["LEAD_GENERATION", "WEBSITE_TRAFFIC", "REGISTRATION", "PROFILE_COMPLETION", "VERIFICATION", "MEMBERSHIP_PROMOTION", "REFERRAL_GROWTH", "AWARENESS", "EVENT_PROMOTION", "WHATSAPP_INQUIRY", "CUSTOM"];
const CHANNELS = ["WEBSITE", "FACEBOOK", "INSTAGRAM", "META_ADS", "WHATSAPP", "TIKTOK", "YOUTUBE", "GOOGLE_ADS", "SEARCH", "EMAIL", "SMS", "REFERRAL", "DIRECT", "EVENT", "OTHER"];

export function MarketingCenterClient({ permissions }: { permissions: string[] }) {
  const can = (p: string) => permissions.includes(p);
  const tabs = [
    { value: "overview", label: "Overview", show: true },
    { value: "campaigns", label: "Campaigns", show: true },
    { value: "ads", label: "Ads", show: can("marketing:ads:view") },
    { value: "creatives", label: "Creatives", show: can("marketing:creatives:view") },
    { value: "forms", label: "Lead forms", show: can("marketing:forms:view") },
    { value: "leads", label: "Marketing leads", show: can("marketing:leads:view") },
    { value: "automation", label: "Automation", show: can("marketing:automation:view") },
    { value: "experiments", label: "Experiments", show: can("marketing:experiments:view") },
    { value: "budgets", label: "Budgets", show: can("marketing:budget:view") },
    { value: "providers", label: "Providers", show: can("marketing:providers:view") },
    { value: "suppression", label: "Suppression", show: can("marketing:suppression:view") },
    { value: "consent", label: "Consent", show: can("marketing:consent:view") },
    { value: "audit", label: "Audit log", show: can("marketing:audit:view") },
  ].filter((t) => t.show);
  const [tab, setTab] = useState("overview");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Marketing Center</h1>
          <p className="text-sm text-muted">Campaigns, landing pages, lead capture and attribution — private-matchmaking marketing with consent, review and approval built in.</p>
        </div>
        {can("marketing:landing_pages:view") && <Link href="/admin/marketing/landing-pages" className="text-sm text-primary hover:underline">Landing pages →</Link>}
      </div>
      <Tabs tabs={tabs.map(({ value, label }) => ({ value, label }))} value={tab} onChange={setTab} />
      {tab === "overview" && <OverviewTab can={can} />}
      {tab === "campaigns" && <CampaignsTab can={can} />}
      {tab === "ads" && <AdsTab can={can} />}
      {tab === "creatives" && <CreativesTab can={can} />}
      {tab === "forms" && <FormsTab can={can} />}
      {tab === "leads" && <LeadsTab can={can} />}
      {tab === "automation" && <AutomationTab can={can} />}
      {tab === "experiments" && <ExperimentsTab can={can} />}
      {tab === "budgets" && <BudgetsTab />}
      {tab === "providers" && <ProvidersTab can={can} />}
      {tab === "suppression" && <SuppressionTab can={can} />}
      {tab === "consent" && <ConsentTab />}
      {tab === "audit" && <AuditTab />}
    </div>
  );
}

// ------------------------------------------------------------------ Overview
interface Analytics {
  campaigns: { total: number; active: number; draft: number; inReview: number };
  advertising: { impressions: number; reach: number; clicks: number; spendMinor: number | null; ctrPct: number | null; cpcMinor: number | null; cpmMinor: number | null; cplMinor: number | null; hasData: boolean };
  funnel: { stages: Array<{ key: string; label: string; value: number; source: string }>; rates: Record<string, number | null>; note: string };
  byChannel: Array<{ channel: string; leads: number }>;
  bySource: Array<{ source: string | null; medium: string | null; leads: number }>;
  leadsByDay: Array<{ day: string; leads: number }>;
  topCampaigns: Array<{ id: string; code: string; name: string; status: string; channel: string; leads: number; spendVerified: boolean; spendVerifiedMinor: number; cplMinor: number | null; currencyCode: string }>;
}
interface Overview {
  flags: Record<string, boolean>;
  pendingApprovals: { campaigns: number; landingPages: number; forms: number; creatives: number };
  analytics: Analytics | null;
  providers: Array<{ providerKey: string; status: string; lastError: string | null; implemented: boolean }> | null;
  webhookIssuesLast7Days: number | null;
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function OverviewTab({ can }: { can: (p: string) => boolean }) {
  const [days, setDays] = useState(30);
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const { data, error, loading } = useApi<Overview>(`/api/admin/marketing?from=${from.toISOString()}&to=${to.toISOString()}`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;
  const a = data.analytics;
  const stage = (k: string) => a?.funnel.stages.find((s) => s.key === k)?.value ?? 0;
  const anyFlagOff = Object.entries(data.flags).some(([k, v]) => k.startsWith("marketing.") && !v);

  return (
    <div className="space-y-4">
      {anyFlagOff && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Some marketing switches are OFF: {Object.entries(data.flags).filter(([, v]) => !v).map(([k]) => k).join(", ")}. Marketing features are disabled by default and are turned on from System Configuration → Feature Flags.
          </span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-40">
          {[7, 30, 90, 180].map((d) => <option key={d} value={d}>Last {d} days</option>)}
        </Select>
        {can("marketing:analytics:export") && (
          <>
            <a className="text-sm text-primary hover:underline" href={`/api/admin/marketing/analytics/export?kind=campaign&from=${from.toISOString()}&to=${to.toISOString()}`}>Export campaign report</a>
            <a className="text-sm text-primary hover:underline" href={`/api/admin/marketing/analytics/export?kind=funnel&from=${from.toISOString()}&to=${to.toISOString()}`}>Export funnel</a>
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Campaigns" value={a?.campaigns.total ?? "—"} hint={a ? `${a.campaigns.active} active` : undefined} />
        <Stat label="Leads" value={a ? stage("LEADS") : "—"} />
        <Stat label="Registrations" value={a ? stage("REGISTRATIONS") : "—"} />
        <Stat label="Verified profiles" value={a ? stage("VERIFIED_PROFILES") : "—"} />
        <Stat label="Verified spend" value={a?.advertising.spendMinor != null ? money(a.advertising.spendMinor) : "—"} hint={a && !a.advertising.hasData ? "No provider data yet" : undefined} />
        <Stat label="Cost per lead" value={a?.advertising.cplMinor != null ? money(a.advertising.cplMinor) : "—"} hint={a?.advertising.cplMinor == null ? "Needs verified spend and enough leads" : undefined} />
      </div>

      {a && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Funnel (marketing only)">
              <FunnelChart stages={a.funnel.stages.map((s) => ({ key: s.key, label: s.source === "provider" ? `${s.label} (ad platform)` : s.label, count: s.value }))} />
              <p className="mt-3 text-xs text-muted">{a.funnel.note}</p>
              <p className="mt-1 text-xs text-muted">Lead→registration: {a.funnel.rates.leadToRegistrationPct ?? "insufficient data"}{a.funnel.rates.leadToRegistrationPct != null ? "%" : ""} · Registration→verified: {a.funnel.rates.registrationToVerifiedPct ?? "insufficient data"}{a.funnel.rates.registrationToVerifiedPct != null ? "%" : ""}</p>
            </Card>
            <Card title="Leads per day">
              <TrendChart data={a.leadsByDay.map((d) => ({ label: new Date(d.day).toLocaleDateString(undefined, { month: "short", day: "numeric" }), series: { leads: d.leads } }))} seriesConfig={[{ key: "leads", label: "Leads", colorClass: "bg-primary" }]} />
            </Card>
            <Card><BarChart title="Leads by channel" data={a.byChannel.map((c) => ({ label: formatEnumLabel(c.channel), count: c.leads }))} /></Card>
            <Card><BarChart title="Leads by source / medium" data={a.bySource.map((s) => ({ label: `${s.source ?? "(none)"} / ${s.medium ?? "(none)"}`, count: s.leads }))} /></Card>
          </div>

          <Card title="Top campaigns">
            {a.topCampaigns.length === 0 ? <EmptyState title="No campaigns yet" /> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="text-left text-xs text-muted"><tr><th className="pb-2">Campaign</th><th className="pb-2">Status</th><th className="pb-2">Channel</th><th className="pb-2 text-right">Leads</th><th className="pb-2 text-right">Cost / lead</th></tr></thead>
                  <tbody>
                    {a.topCampaigns.map((c) => (
                      <tr key={c.id} className="border-t border-border">
                        <td className="py-2"><Link href={`/admin/marketing/campaigns/${c.id}`} className="font-medium text-primary hover:underline">{c.code}</Link> <span className="text-muted">{c.name}</span></td>
                        <td className="py-2"><StatusBadge status={c.status} /></td>
                        <td className="py-2">{formatEnumLabel(c.channel)}</td>
                        <td className="py-2 text-right">{c.leads}</td>
                        <td className="py-2 text-right">{c.cplMinor != null ? money(c.cplMinor, c.currencyCode) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Pending approvals">
          <ul className="space-y-1 text-sm">
            <li>Campaigns in review: <strong>{data.pendingApprovals.campaigns}</strong></li>
            <li>Landing page versions in review: <strong>{data.pendingApprovals.landingPages}</strong></li>
            <li>Lead form versions in review: <strong>{data.pendingApprovals.forms}</strong></li>
            <li>Creatives in review: <strong>{data.pendingApprovals.creatives}</strong></li>
          </ul>
          <p className="mt-2 text-xs text-muted">Launches, budget increases, page publishing and provider changes also appear in Approvals.</p>
        </Card>
        {data.providers && (
          <Card title="Provider status">
            <ul className="space-y-1 text-sm">
              {data.providers.map((p) => (
                <li key={p.providerKey} className="flex items-center justify-between"><span>{formatEnumLabel(p.providerKey)}{!p.implemented ? " (not implemented)" : ""}</span><StatusBadge status={p.status} /></li>
              ))}
            </ul>
            {data.webhookIssuesLast7Days != null && <p className="mt-2 text-xs text-muted">Webhook deliveries needing attention (7 days): {data.webhookIssuesLast7Days}</p>}
          </Card>
        )}
      </div>

      {can("ai:marketing:use") && <AiAssistantPanel />}
    </div>
  );
}

// ------------------------------------------------------------------ Campaigns
interface CampaignRow {
  id: string; code: string; name: string; status: string; objective: string; channel: string; providerKey: string; leadCount: number; startAt: string | null; endAt: string | null;
  budget: { currencyCode: string; totalMinor: number; spendVerified: boolean; spendVerifiedMinor: number | null; remainingMinor: number | null } | null;
}

function CampaignsTab({ can }: { can: (p: string) => boolean }) {
  const { show } = useToast();
  const [status, setStatus] = useState("");
  const { data, error, loading, reload } = useApi<{ items: CampaignRow[]; nextCursor: string | null }>(`/api/admin/marketing/campaigns${status ? `?status=${status}` : ""}`);
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState({ name: "", campaignKey: "", objective: "LEAD_GENERATION", channel: "WEBSITE", budget: "0", description: "" });

  async function create() {
    const budgetMinor = Math.round(Number(f.budget) * 100);
    if (!Number.isFinite(budgetMinor) || budgetMinor < 0) return show("Enter a valid budget.", "error");
    const ok = await act(show, "/api/admin/marketing/campaigns", "POST", { name: f.name, campaignKey: f.campaignKey, objective: f.objective, channel: f.channel, budgetTotalMinor: budgetMinor, description: f.description || undefined, attributionModel: "LAST_TOUCH" }, "Campaign created as a draft.");
    if (ok) { setCreating(false); setF({ name: "", campaignKey: "", objective: "LEAD_GENERATION", channel: "WEBSITE", budget: "0", description: "" }); reload(); }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44"><option value="">Any status</option>{["DRAFT", "IN_REVIEW", "APPROVED", "SCHEDULED", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"].map((s) => <option key={s} value={s}>{formatEnumLabel(s)}</option>)}</Select>
        {can("marketing:create") && <Button onClick={() => setCreating((c) => !c)}>{creating ? "Cancel" : "New campaign"}</Button>}
      </div>
      {creating && (
        <Card title="New campaign (created as a draft)">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Campaign key (utm_campaign)" hint="Lowercase letters, numbers, - and _"><Input value={f.campaignKey} onChange={(e) => setF({ ...f, campaignKey: e.target.value.toLowerCase() })} /></Field>
            <Field label="Objective"><Select value={f.objective} onChange={(e) => setF({ ...f, objective: e.target.value })}>{OBJECTIVES.map((o) => <option key={o} value={o}>{formatEnumLabel(o)}</option>)}</Select></Field>
            <Field label="Channel"><Select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>{CHANNELS.map((o) => <option key={o} value={o}>{formatEnumLabel(o)}</option>)}</Select></Field>
            <Field label="Total budget (PKR)"><Input type="number" min={0} value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} /></Field>
            <Field label="Description" className="sm:col-span-2"><Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          </div>
          <div className="mt-3"><Button onClick={create} disabled={!f.name || !f.campaignKey}>Create draft</Button></div>
        </Card>
      )}
      {loading && !data ? <Loading /> : error ? <ErrorNote message={error} /> : !data || data.items.length === 0 ? <EmptyState title="No campaigns yet" description="Create a draft, then submit it for review." /> : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface p-3">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="pb-2">Campaign</th><th className="pb-2">Status</th><th className="pb-2">Objective</th><th className="pb-2">Channel</th><th className="pb-2 text-right">Leads</th><th className="pb-2 text-right">Budget</th></tr></thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="py-2"><Link href={`/admin/marketing/campaigns/${c.id}`} className="font-medium text-primary hover:underline">{c.code}</Link> <span className="text-muted">{c.name}</span></td>
                  <td className="py-2"><StatusBadge status={c.status} /></td>
                  <td className="py-2">{formatEnumLabel(c.objective)}</td>
                  <td className="py-2">{formatEnumLabel(c.channel)}</td>
                  <td className="py-2 text-right">{c.leadCount}</td>
                  <td className="py-2 text-right">{c.budget ? money(c.budget.totalMinor, c.budget.currencyCode) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Budgets
function BudgetsTab() {
  const { data, error, loading } = useApi<{ items: CampaignRow[] }>("/api/admin/marketing/campaigns?take=100");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote message={error} />;
  const rows = data?.items.filter((c) => c.budget) ?? [];
  return rows.length === 0 ? <EmptyState title="No budgets yet" /> : (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface p-3">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="text-left text-xs text-muted"><tr><th className="pb-2">Campaign</th><th className="pb-2">Status</th><th className="pb-2 text-right">Total budget</th><th className="pb-2 text-right">Verified spend</th><th className="pb-2 text-right">Remaining</th></tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-t border-border">
              <td className="py-2"><Link href={`/admin/marketing/campaigns/${c.id}?tab=budget`} className="font-medium text-primary hover:underline">{c.code}</Link></td>
              <td className="py-2"><StatusBadge status={c.status} /></td>
              <td className="py-2 text-right">{money(c.budget!.totalMinor, c.budget!.currencyCode)}</td>
              <td className="py-2 text-right">{c.budget!.spendVerified ? money(c.budget!.spendVerifiedMinor, c.budget!.currencyCode) : <span className="text-muted">not verified</span>}</td>
              <td className="py-2 text-right">{c.budget!.remainingMinor != null ? money(c.budget!.remainingMinor, c.budget!.currencyCode) : <span className="text-muted">unknown</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted">Remaining budget is only shown once spend has been verified from the ad provider; until then it is unknown, not assumed.</p>
    </div>
  );
}
