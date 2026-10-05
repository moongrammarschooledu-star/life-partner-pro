"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { Card, ErrorNote, Loading, StatusBadge, timeAgo, useApi } from "@/components/admin/system/shared";
import { act } from "@/components/admin/marketing/shared";
import { formatDateTime, formatEnumLabel } from "@/lib/utils";

type Can = (p: string) => boolean;

// ------------------------------------------------------------------ Automation
interface Rule { id: string; name: string; trigger: string; enabled: boolean; version: number; actions: Array<{ type: string }>; createdById: string }
const ACTION_TYPES = ["CREATE_TASK", "ASSIGN_LEAD", "SCHEDULE_FOLLOWUP", "NOTIFY_STAFF", "UPDATE_CRM_STAGE"];

export function AutomationTab({ can }: { can: Can }) {
  const { show } = useToast();
  const { data, error, loading, reload } = useApi<{ triggers: string[]; rules: Rule[]; runs: Array<{ id: string; ruleId: string; status: string; error: string | null; createdAt: string }> }>("/api/admin/marketing/automation");
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState({ name: "", trigger: "LEAD_CREATED", action: "CREATE_TASK", title: "Follow up new marketing lead", dueInHours: "24", toStage: "PROFILE_INCOMPLETE" });

  async function create() {
    const a = f.action;
    const action = a === "CREATE_TASK" ? { type: a, title: f.title } : a === "SCHEDULE_FOLLOWUP" ? { type: a, title: f.title, dueInHours: Number(f.dueInHours) } : a === "UPDATE_CRM_STAGE" ? { type: a, toStage: f.toStage } : { type: a };
    if (await act(show, "/api/admin/marketing/automation", "POST", { name: f.name, trigger: f.trigger, actions: [action] }, "Rule created (disabled until another admin enables it).")) { setCreating(false); reload(); }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Automation can only create tasks, assign, schedule follow-up tasks, notify staff and move a converted applicant forward through early stages. It can never approve verification, share contacts, finalize proposals, suspend or delete accounts, refund, launch ads, change budgets or message people without consent. A rule must be enabled by someone other than its author.</p>
      {can("marketing:automation:manage") && <Button onClick={() => setCreating((c) => !c)}>{creating ? "Cancel" : "New rule"}</Button>}
      {creating && data && (
        <Card title="New automation rule">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="When"><Select value={f.trigger} onChange={(e) => setF({ ...f, trigger: e.target.value })}>{data.triggers.map((t) => <option key={t} value={t}>{formatEnumLabel(t)}</option>)}</Select></Field>
            <Field label="Then"><Select value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}>{ACTION_TYPES.map((t) => <option key={t} value={t}>{formatEnumLabel(t)}</option>)}</Select></Field>
            {(f.action === "CREATE_TASK" || f.action === "SCHEDULE_FOLLOWUP") && <Field label="Task title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>}
            {f.action === "SCHEDULE_FOLLOWUP" && <Field label="Due in (hours)"><Input type="number" min={1} value={f.dueInHours} onChange={(e) => setF({ ...f, dueInHours: e.target.value })} /></Field>}
            {f.action === "UPDATE_CRM_STAGE" && <Field label="Move to stage"><Select value={f.toStage} onChange={(e) => setF({ ...f, toStage: e.target.value })}>{["PROFILE_INCOMPLETE", "PROFILE_SUBMITTED", "UNDER_REVIEW", "VERIFICATION_PENDING"].map((s) => <option key={s} value={s}>{formatEnumLabel(s)}</option>)}</Select></Field>}
          </div>
          <div className="mt-3"><Button onClick={create} disabled={!f.name}>Create rule</Button></div>
        </Card>
      )}
      {loading && !data ? <Loading /> : error ? <ErrorNote message={error} /> : !data || data.rules.length === 0 ? <EmptyState title="No automation rules yet" /> : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface p-3">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="pb-2">Rule</th><th className="pb-2">Trigger</th><th className="pb-2">Actions</th><th className="pb-2">State</th><th className="pb-2 text-right">Actions</th></tr></thead>
            <tbody>
              {data.rules.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="py-2 font-medium">{r.name} <span className="text-xs font-normal text-muted">v{r.version}</span></td>
                  <td className="py-2">{formatEnumLabel(r.trigger)}</td>
                  <td className="py-2">{r.actions.map((a) => formatEnumLabel(a.type)).join(", ")}</td>
                  <td className="py-2"><StatusBadge status={r.enabled ? "ACTIVE" : "DISABLED"} /></td>
                  <td className="py-2 text-right">
                    {can("marketing:automation:manage") && (
                      <Button size="sm" variant="outline" onClick={async () => { const reason = window.prompt(r.enabled ? "Reason for disabling" : "Reason for enabling"); if (reason && (await act(show, `/api/admin/marketing/automation/${r.id}/enable`, "POST", { enabled: !r.enabled, reason }, r.enabled ? "Rule disabled." : "Rule enabled."))) reload(); }}>{r.enabled ? "Disable" : "Enable"}</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.runs.length > 0 && (
        <Card title="Recent runs">
          <ul className="space-y-1 text-sm">{data.runs.slice(0, 15).map((r) => <li key={r.id} className="flex items-center justify-between"><span className="text-muted">{timeAgo(r.createdAt)}</span><StatusBadge status={r.status} />{r.error && <span className="text-danger text-xs">{r.error}</span>}</li>)}</ul>
        </Card>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Experiments
interface Experiment { id: string; name: string; status: string; minSampleSize: number; primaryMetric: string; variants: Array<{ key: string; label: string; trafficPct: number }> }
interface ExperimentReport { results: Array<{ key: string; label: string; exposures: number; conversions: number; ratePct: number | null }>; verdict: { status: string; message: string } }

export function ExperimentsTab({ can }: { can: Can }) {
  const { show } = useToast();
  const { data, error, loading, reload } = useApi<{ items: Experiment[] }>("/api/admin/marketing/experiments");
  const [open, setOpen] = useState<string | null>(null);
  const report = useApi<ExperimentReport>(open ? `/api/admin/marketing/experiments/${open}` : null);
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState({ name: "", landingPageId: "", headlineB: "", minSample: "100" });

  async function create() {
    const variants = [{ key: "control", label: "Original", trafficPct: 50 }, { key: "variant_b", label: "Alternative headline", trafficPct: 50, overrides: { heroHeading: f.headlineB } }];
    if (await act(show, "/api/admin/marketing/experiments", "POST", { name: f.name, landingPageId: f.landingPageId || null, variants, minSampleSize: Number(f.minSample) }, "Experiment created as a draft.")) { setCreating(false); reload(); }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">A/B tests compare the original against an alternative hero headline on a landing page. Results show &ldquo;Insufficient data&rdquo; until every variant reaches the minimum sample, and no winner is ever applied automatically.</p>
      {can("marketing:experiments:manage") && <Button onClick={() => setCreating((c) => !c)}>{creating ? "Cancel" : "New experiment"}</Button>}
      {creating && (
        <Card title="New experiment (50/50, headline test)">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Landing page id"><Input value={f.landingPageId} onChange={(e) => setF({ ...f, landingPageId: e.target.value.trim() })} /></Field>
            <Field label="Alternative headline" className="sm:col-span-2"><Input maxLength={120} value={f.headlineB} onChange={(e) => setF({ ...f, headlineB: e.target.value })} /></Field>
            <Field label="Minimum visitors per variant"><Input type="number" min={30} value={f.minSample} onChange={(e) => setF({ ...f, minSample: e.target.value })} /></Field>
          </div>
          <div className="mt-3"><Button onClick={create} disabled={!f.name || !f.headlineB || !f.landingPageId}>Create</Button></div>
        </Card>
      )}
      {loading && !data ? <Loading /> : error ? <ErrorNote message={error} /> : !data || data.items.length === 0 ? <EmptyState title="No experiments yet" /> : (
        <div className="space-y-2">
          {data.items.map((e) => (
            <Card key={e.id} title={e.name} action={<StatusBadge status={e.status} />}>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Button size="sm" variant="outline" onClick={() => setOpen(open === e.id ? null : e.id)}>{open === e.id ? "Hide results" : "View results"}</Button>
                {can("marketing:experiments:manage") && e.status === "DRAFT" && <Button size="sm" onClick={async () => { if (await act(show, `/api/admin/marketing/experiments/${e.id}/status`, "POST", { status: "RUNNING" }, "Experiment started.")) reload(); }}>Start</Button>}
                {can("marketing:experiments:manage") && e.status === "RUNNING" && <Button size="sm" variant="outline" onClick={async () => { if (await act(show, `/api/admin/marketing/experiments/${e.id}/status`, "POST", { status: "STOPPED" }, "Experiment stopped.")) reload(); }}>Stop</Button>}
              </div>
              {open === e.id && report.data && (
                <div className="mt-3 space-y-2 text-sm">
                  <table className="w-full"><thead className="text-left text-xs text-muted"><tr><th>Variant</th><th className="text-right">Visitors</th><th className="text-right">Conversions</th><th className="text-right">Rate</th></tr></thead>
                    <tbody>{report.data.results.map((r) => <tr key={r.key} className="border-t border-border"><td className="py-1">{r.label}</td><td className="text-right">{r.exposures}</td><td className="text-right">{r.conversions}</td><td className="text-right">{r.ratePct == null ? "—" : `${r.ratePct}%`}</td></tr>)}</tbody></table>
                  <p className="font-medium">{report.data.verdict.status === "INSUFFICIENT_DATA" ? "Insufficient data" : formatEnumLabel(report.data.verdict.status)}</p>
                  <p className="text-muted">{report.data.verdict.message}</p>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Providers
interface ProviderRow { providerKey: string; implemented: boolean; usesSandboxAdapter: boolean; secretsPresent: Record<string, boolean>; status: string; lastSyncAt: string | null; lastError: string | null; webhookStatus: string | null; lastWebhookAt: string | null }

export function ProvidersTab({ can }: { can: Can }) {
  const { show } = useToast();
  const { data, error, loading, reload } = useApi<{ items: ProviderRow[] }>("/api/admin/marketing/providers");
  const events = useApi<{ items: Array<{ id: string; source: string; status: string; eventType: string | null; rejectReason: string | null; receivedAt: string }> }>("/api/admin/marketing/webhook-events?take=15");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote message={error} />;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Credentials live in server environment variables; this screen only shows whether each variable is set — never its value. Connecting or disconnecting a provider needs an independent approval. Outside production, or without credentials, the sandbox adapter is used and nothing is sent to an ad platform.</p>
      {data?.items.map((p) => (
        <Card key={p.providerKey} title={formatEnumLabel(p.providerKey)} action={<StatusBadge status={p.status} />}>
          <div className="space-y-1 text-sm">
            {!p.implemented && <p className="text-muted">Not implemented in this release.</p>}
            {p.implemented && p.providerKey !== "SANDBOX" && (
              <>
                <p>Active adapter: <strong>{p.usesSandboxAdapter ? "Sandbox (no external calls)" : "Live"}</strong></p>
                <ul className="text-xs text-muted">{Object.entries(p.secretsPresent).map(([n, ok]) => <li key={n}>{n}: {ok ? "set" : "not set"}</li>)}</ul>
                <p className="text-xs text-muted">Last sync: {p.lastSyncAt ? formatDateTime(p.lastSyncAt) : "never"}{p.lastError ? ` · last error: ${p.lastError}` : ""}</p>
                {can("marketing:providers:manage") && (
                  <div className="space-x-2 pt-1">
                    <Button size="sm" onClick={async () => { const reason = window.prompt("Reason for connecting / re-validating"); if (reason && (await act(show, "/api/admin/marketing/providers", "POST", { providerKey: p.providerKey, reason }, "Provider connection checked."))) reload(); }}>Connect / validate</Button>
                    <Button size="sm" variant="danger" onClick={async () => { const reason = window.prompt("Reason for disconnecting"); if (reason && (await act(show, `/api/admin/marketing/providers/${p.providerKey}`, "DELETE", { reason }, "Provider disconnected."))) reload(); }}>Disconnect</Button>
                  </div>
                )}
              </>
            )}
          </div>
        </Card>
      ))}
      <Card title="Recent webhook deliveries">
        {!events.data || events.data.items.length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
          <ul className="space-y-1 text-sm">{events.data.items.map((e) => <li key={e.id} className="flex items-center justify-between gap-2"><span>{formatEnumLabel(e.source)} · {e.eventType ?? "—"}</span><span className="flex items-center gap-2"><StatusBadge status={e.status} />{e.rejectReason && <span className="text-xs text-muted">{e.rejectReason}</span>}<span className="text-xs text-muted">{timeAgo(e.receivedAt)}</span></span></li>)}</ul>
        )}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ Suppression
interface Suppression { id: string; channel: string; scope: string; reason: string; status: string; ref: string | null; note: string | null; createdAt: string }

export function SuppressionTab({ can }: { can: Can }) {
  const { show } = useToast();
  const { data, error, loading, reload } = useApi<{ reasons: string[]; items: Suppression[] }>("/api/admin/marketing/suppression");
  const [f, setF] = useState({ phone: "", email: "", reason: "USER_REQUEST", scope: "MARKETING", note: "" });
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">People on this list are never captured by marketing forms or contacted for marketing. Entries are stored as salted hashes, so this list holds no contact details.</p>
      {can("marketing:suppression:manage") && data && (
        <Card title="Add to suppression list">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Mobile number"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
            <Field label="Email"><Input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
            <Field label="Reason"><Select value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>{data.reasons.map((r) => <option key={r} value={r}>{formatEnumLabel(r)}</option>)}</Select></Field>
            <Field label="Applies to"><Select value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}><option value="MARKETING">Marketing only</option><option value="ALL">All messages</option></Select></Field>
            <Field label="Note" className="sm:col-span-2"><Textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
          </div>
          <div className="mt-3"><Button disabled={!f.phone && !f.email} onClick={async () => { if (await act(show, "/api/admin/marketing/suppression", "POST", { ...f, phone: f.phone || undefined, email: f.email || undefined, note: f.note || undefined }, "Added to the suppression list.")) { setF({ ...f, phone: "", email: "", note: "" }); reload(); } }}>Add</Button></div>
        </Card>
      )}
      {loading && !data ? <Loading /> : error ? <ErrorNote message={error} /> : !data || data.items.length === 0 ? <EmptyState title="The suppression list is empty" /> : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface p-3">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="pb-2">Ref</th><th className="pb-2">Channel</th><th className="pb-2">Scope</th><th className="pb-2">Reason</th><th className="pb-2">Status</th><th className="pb-2 text-right">Action</th></tr></thead>
            <tbody>
              {data.items.map((s) => (
                <tr key={s.id} className="border-t border-border">
                  <td className="py-2 font-mono text-xs">…{s.ref ?? "—"}</td><td className="py-2">{formatEnumLabel(s.channel)}</td><td className="py-2">{formatEnumLabel(s.scope)}</td><td className="py-2">{formatEnumLabel(s.reason)}</td><td className="py-2"><StatusBadge status={s.status} /></td>
                  <td className="py-2 text-right">{s.status === "ACTIVE" && can("marketing:suppression:manage") && <Button size="sm" variant="outline" onClick={async () => { const reason = window.prompt("Reason for lifting this suppression (hard reasons need 20+ characters)"); if (reason && (await act(show, `/api/admin/marketing/suppression/${s.id}/lift`, "POST", { reason }, "Suppression lifted."))) reload(); }}>Lift</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Consent
export function ConsentTab() {
  const { data, error, loading } = useApi<{ byPurpose: Array<{ purpose: string; channel: string | null; granted: boolean; count: number }>; withdrawn: number; leadsWithMarketingOptIn: number; marketingLeads: number; note: string }>("/api/admin/marketing/consent");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <Card title="Marketing leads"><p className="text-2xl font-semibold">{data.marketingLeads}</p></Card>
        <Card title="With marketing opt-in"><p className="text-2xl font-semibold">{data.leadsWithMarketingOptIn}</p></Card>
        <Card title="Consents withdrawn"><p className="text-2xl font-semibold">{data.withdrawn}</p></Card>
      </div>
      <Card title="Consent evidence by purpose and channel">
        <ul className="space-y-1 text-sm">{data.byPurpose.map((r, i) => <li key={i} className="flex justify-between"><span>{formatEnumLabel(r.purpose)}{r.channel ? ` · ${formatEnumLabel(r.channel)}` : ""} · {r.granted ? "granted" : "declined"}</span><strong>{r.count}</strong></li>)}</ul>
        <p className="mt-2 text-xs text-muted">{data.note}</p>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ Audit
export function AuditTab() {
  const [action, setAction] = useState("");
  const { data, error, loading } = useApi<{ items: Array<{ id: string; action: string; adminId: string | null; meta: string | null; createdAt: string }> }>(`/api/admin/marketing/audit${action ? `?action=${action}` : ""}`);
  return (
    <div className="space-y-3">
      <Input value={action} onChange={(e) => setAction(e.target.value.trim().toUpperCase())} placeholder="Filter by action, e.g. MARKETING_CAMPAIGN_LAUNCHED" className="max-w-md" />
      {loading && !data ? <Loading /> : error ? <ErrorNote message={error} /> : !data || data.items.length === 0 ? <EmptyState title="No marketing audit entries" /> : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface p-3">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="pb-2">When</th><th className="pb-2">Action</th><th className="pb-2">Actor</th><th className="pb-2">Detail</th></tr></thead>
            <tbody>
              {data.items.map((a) => (
                <tr key={a.id} className="border-t border-border align-top">
                  <td className="py-2 whitespace-nowrap text-muted">{formatDateTime(a.createdAt)}</td><td className="py-2">{formatEnumLabel(a.action.replace(/^MARKETING_/, ""))}</td><td className="py-2 font-mono text-xs">{a.adminId ? a.adminId.slice(-6) : "system"}</td>
                  <td className="py-2 max-w-md truncate text-xs text-muted" title={a.meta ?? ""}>{a.meta}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
