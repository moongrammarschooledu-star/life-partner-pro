"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Tabs } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { Card, ErrorNote, KV, Loading, StatusBadge, callApi, timeAgo, useApi } from "@/components/admin/system/shared";
import { formatDateTime, formatEnumLabel } from "@/lib/utils";

// Admin -> Communications. A shell over the STEP 25 APIs: every call enforces its own permission on the server, and the tabs shown
// here only mirror what the viewer may open. Nothing on this page ever shows a full address or a provider credential.

const CHANNELS = ["EMAIL", "SMS", "WHATSAPP", "IN_APP"];

export function CommunicationsClient({ permissions, testModeWarning }: { permissions: string[]; testModeWarning: string | null }) {
  const can = (p: string) => permissions.includes(p);
  const tabs = [
    { value: "logs", label: "Messages", show: can("communications:logs:view") },
    { value: "failed", label: "Queue & failed", show: can("communications:logs:view") },
    { value: "templates", label: "Templates", show: can("communications:templates:view") },
    { value: "campaigns", label: "Campaigns", show: can("communications:campaigns:view") },
    { value: "providers", label: "Providers", show: can("communications:providers:view") },
    { value: "suppressions", label: "Suppressions", show: can("communications:view") },
    { value: "analytics", label: "Analytics", show: can("communications:analytics:view") },
    { value: "policies", label: "Policies", show: can("communications:providers:view") },
  ].filter((t) => t.show);
  const [tab, setTab] = useState(tabs[0]?.value ?? "logs");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Communications</h1>
          <p className="text-sm text-muted">Email, SMS, WhatsApp and in-app messages: consent-aware, jurisdiction-aware and audited. To message one applicant, use the Communication Center.</p>
        </div>
        <Link href="/admin/communication-center" className="text-sm text-primary hover:underline">Compose / Communication Center</Link>
      </div>
      {testModeWarning && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{testModeWarning}</span>
        </div>
      )}
      <Tabs tabs={tabs.map(({ value, label }) => ({ value, label }))} value={tab} onChange={setTab} />
      {tab === "logs" && <LogsTab />}
      {tab === "failed" && <FailedTab canSend={can("communications:send")} />}
      {tab === "templates" && <TemplatesTab can={can} />}
      {tab === "campaigns" && <CampaignsTab can={can} />}
      {tab === "providers" && <ProvidersTab canManage={can("communications:providers:manage")} />}
      {tab === "suppressions" && <SuppressionsTab canSuppress={can("communications:suppress")} />}
      {tab === "analytics" && <AnalyticsTab canExport={can("communications:export")} />}
      {tab === "policies" && <PoliciesTab />}
    </div>
  );
}

// ------------------------------------------------------------------ Messages
interface LogRow { id: string; channel: string; purpose: string | null; messageType: string | null; deliveryStatus: string; recipientReference: string | null; provider: string | null; blockedReason: string | null; failureReason: string | null; createdAt: string; templateId: string | null }

function LogsTab() {
  const [channel, setChannel] = useState("");
  const [status, setStatus] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [profileId, setProfileId] = useState("");
  const qs = new URLSearchParams({ ...(channel ? { channel } : {}), ...(status ? { status } : {}), ...(blocked ? { blocked: "true" } : {}), ...(profileId ? { profileId } : {}) }).toString();
  const { data, error, loading } = useApi<{ items: LogRow[] }>(`/api/admin/communications/logs?${qs}`);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Select value={channel} onChange={(e) => setChannel(e.target.value)} className="w-36"><option value="">Any channel</option>{CHANNELS.map((c) => <option key={c} value={c}>{formatEnumLabel(c)}</option>)}</Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40"><option value="">Any status</option>{["QUEUED", "SENDING", "SENT", "DELIVERED", "READ", "FAILED", "BOUNCED", "REJECTED", "EXPIRED", "CANCELLED"].map((s) => <option key={s} value={s}>{formatEnumLabel(s)}</option>)}</Select>
        <Input value={profileId} onChange={(e) => setProfileId(e.target.value.trim())} placeholder="Profile id (required for assignment-scoped staff)" className="w-72" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={blocked} onChange={(e) => setBlocked(e.target.checked)} /> Blocked by policy only</label>
      </div>
      <p className="text-xs text-muted">Addresses are masked and content is never shown in this list. A delivery state appears only when the provider reported it.</p>
      {loading && !data && <Loading />}
      {error && <ErrorNote message={error} />}
      {data && data.items.length === 0 && <EmptyState title="No messages" description="Nothing matches this filter." />}
      {data && data.items.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {data.items.map((l) => (
            <li key={l.id}>
              <button className="flex w-full flex-wrap items-center justify-between gap-2 p-3 text-left text-sm hover:bg-surface-muted" onClick={() => setOpen(open === l.id ? null : l.id)}>
                <span className="flex flex-wrap items-center gap-2">
                  <Badge>{formatEnumLabel(l.channel)}</Badge>
                  <StatusBadge status={l.deliveryStatus} />
                  <span className="text-muted">{l.messageType ? formatEnumLabel(l.messageType) : "—"}</span>
                  <span className="font-mono text-xs">{l.recipientReference ?? "—"}</span>
                  {l.blockedReason && <Badge variant="warning">{l.blockedReason.replace("BLOCKED_", "").toLowerCase()}</Badge>}
                </span>
                <span className="text-xs text-muted">{timeAgo(l.createdAt)}</span>
              </button>
              {open === l.id && <LogDetail id={l.id} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface LogDetailData { provider: string | null; attempts: number; failureReason: string | null; content: string | null; contentAccessible: boolean; contentRetained: boolean; events: { id: string; eventType: string; source: string; detail: string | null; occurredAt: string }[] }

function LogDetail({ id }: { id: string }) {
  const { data, error, loading } = useApi<LogDetailData>(`/api/admin/communications/logs/${id}`);
  return (
    <div className="space-y-2 border-t border-border bg-surface-muted p-3 text-sm">
      {loading && <Loading />}
      {error && <ErrorNote message={error} />}
      {data && (
        <>
          <div className="grid gap-2 md:grid-cols-3">
            <KV label="Provider">{data.provider ?? "—"}</KV>
            <KV label="Attempts">{data.attempts}</KV>
            <KV label="Failure">{data.failureReason ?? "—"}</KV>
          </div>
          <div>
            <div className="text-xs font-medium text-muted">Content</div>
            {data.content ? <p className="whitespace-pre-wrap rounded border border-border bg-surface p-2">{data.content}</p> : <p className="text-xs text-muted">{!data.contentAccessible ? "Message content needs the sensitive-communication permission." : data.contentRetained ? "Not available." : "Removed by the retention policy."}</p>}
          </div>
          <div>
            <div className="text-xs font-medium text-muted">Timeline</div>
            <ul className="space-y-1">{data.events.map((e) => <li key={e.id} className="text-xs"><span className="font-medium">{formatEnumLabel(e.eventType)}</span> <span className="text-muted">({e.source.toLowerCase()}) {formatDateTime(e.occurredAt)}{e.detail ? ` — ${e.detail}` : ""}</span></li>)}</ul>
          </div>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Queue & failed
function FailedTab({ canSend }: { canSend: boolean }) {
  const { data, error, loading, reload } = useApi<{ items: (LogRow & { attempts: number; deadLetteredAt: string | null; failureClass: string | null })[] }>("/api/admin/communications/dead-letter");
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
  async function drain() {
    setBusy(true);
    const r = await callApi<{ sent?: number; attempted?: number; requeued?: number; failed?: number }>("/api/admin/communications/queue/process", "POST", {});
    setBusy(false);
    if (!r.ok) show(r.data.error ?? "Could not process the queue", "error");
    else { show(`Processed ${r.data.attempted ?? 0}: ${r.data.sent ?? 0} sent, ${r.data.requeued ?? 0} re-queued, ${r.data.failed ?? 0} failed`, "success"); reload(); }
  }
  async function retry(id: string) {
    const r = await callApi(`/api/admin/communications/logs/${id}/retry`, "POST", {});
    if (!r.ok) show(r.data.error ?? "Could not retry", "error");
    else { show("Retried", "success"); reload(); }
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">Messages that could not be delivered (dead letters). Retries back off automatically; a permanent failure needs a provider manager to retry.</p>
        {canSend && <Button onClick={drain} disabled={busy}><Send className="mr-1 h-4 w-4" /> Process queue now</Button>}
      </div>
      {loading && !data && <Loading />}
      {error && <ErrorNote message={error} />}
      {data && data.items.length === 0 && <EmptyState title="No failed messages" />}
      {data && data.items.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {data.items.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <span className="flex flex-wrap items-center gap-2">
                <Badge>{formatEnumLabel(l.channel)}</Badge>
                <StatusBadge status={l.deliveryStatus} />
                <Badge variant={l.failureClass === "PERMANENT" ? "danger" : "warning"}>{l.failureClass ?? "—"}</Badge>
                <span className="text-muted">{l.failureReason ?? "—"}</span>
                <span className="text-xs text-muted">{l.attempts} attempt(s), {timeAgo(l.deadLetteredAt)}</span>
              </span>
              {canSend && <Button size="sm" variant="secondary" onClick={() => retry(l.id)}>Retry</Button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Templates
interface TemplateRow { id: string; templateCode: string; name: string; channel: string; messageType: string; purpose: string; language: string; eventKey: string | null; status: string; currentVersion: number; activeVersion: number | null; providerStatus: string | null }

function TemplatesTab({ can }: { can: (p: string) => boolean }) {
  const { data, error, loading, reload } = useApi<{ items: TemplateRow[]; allowedVariables: string[] }>("/api/admin/communications/templates");
  const { show } = useToast();
  const [creating, setCreating] = useState(false);
  const [preview, setPreview] = useState<{ id: string; text: string; subject: string | null; error?: string } | null>(null);

  async function act(id: string, action: string) {
    const r = await callApi<{ approvalRequired?: boolean; approvalCode?: string }>(`/api/admin/communications/templates/${id}/${action}`, "POST", {});
    if (!r.ok) show(r.data.error ?? `Could not ${action}`, "error");
    else if (r.data.approvalRequired) show(`Sent for approval (${r.data.approvalCode})`, "success");
    else { show(`Template ${action} done`, "success"); reload(); }
  }
  async function showPreview(id: string) {
    const r = await callApi<{ ok?: boolean; text?: string; subject?: string | null; message?: string }>(`/api/admin/communications/templates/${id}/preview`, "POST", {});
    setPreview(r.ok ? { id, text: r.data.text ?? "", subject: r.data.subject ?? null } : { id, text: "", subject: null, error: r.data.message ?? r.data.error ?? "Cannot render" });
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">Draft → review → approved → active. An active version is never edited in place, and you cannot approve a version you wrote.</p>
        {can("communications:templates:create") && <Button onClick={() => setCreating((v) => !v)}>{creating ? "Close" : "New template"}</Button>}
      </div>
      {creating && data && <TemplateForm allowed={data.allowedVariables} onDone={() => { setCreating(false); reload(); }} />}
      {loading && !data && <Loading />}
      {error && <ErrorNote message={error} />}
      {data && data.items.length === 0 && <EmptyState title="No templates yet" description="Built-in notification copy is used until an approved template is bound to an event." />}
      {data && data.items.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {data.items.map((t) => (
            <li key={t.id} className="space-y-2 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs">{t.templateCode}</span>
                  <span className="font-medium">{t.name}</span>
                  <Badge>{formatEnumLabel(t.channel)}</Badge>
                  <Badge>{t.language}</Badge>
                  <StatusBadge status={t.status} />
                  {t.eventKey && <span className="text-xs text-muted">event: {t.eventKey}</span>}
                  <span className="text-xs text-muted">v{t.currentVersion}{t.activeVersion ? ` (live v${t.activeVersion})` : ""}</span>
                  {t.channel === "WHATSAPP" && <Badge variant={t.providerStatus === "APPROVED" || t.providerStatus === "ACTIVE" ? "success" : "warning"}>provider: {t.providerStatus ?? "not submitted"}</Badge>}
                </span>
                <span className="flex flex-wrap gap-1">
                  <Button size="sm" variant="ghost" onClick={() => showPreview(t.id)}>Preview</Button>
                  {can("communications:templates:edit") && <Button size="sm" variant="secondary" onClick={() => act(t.id, "submit")}>Submit</Button>}
                  {can("communications:templates:approve") && <Button size="sm" variant="secondary" onClick={() => act(t.id, "approve")}>Approve</Button>}
                  {can("communications:templates:activate") && <Button size="sm" onClick={() => act(t.id, "activate")}>Activate</Button>}
                </span>
              </div>
              {preview?.id === t.id && (
                <div className="rounded border border-border bg-surface-muted p-2">
                  {preview.error ? <p className="text-danger">{preview.error}</p> : (<>{preview.subject && <div className="font-medium">{preview.subject}</div>}<p className="whitespace-pre-wrap">{preview.text}</p><p className="mt-1 text-xs text-muted">Rendered with sample values only.</p></>)}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TemplateForm({ allowed, onDone }: { allowed: string[]; onDone: () => void }) {
  const { show } = useToast();
  const [f, setF] = useState({ name: "", channel: "EMAIL", messageType: "TRANSACTIONAL", purpose: "ACCOUNT", language: "EN", eventKey: "", subject: "", body: "" });
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  async function submit() {
    const r = await callApi("/api/admin/communications/templates", "POST", { ...f, eventKey: f.eventKey || undefined, subject: f.subject || undefined });
    if (!r.ok) show(r.data.error ?? "Could not create the template", "error");
    else { show("Template created as a draft", "success"); onDone(); }
  }
  return (
    <Card title="New template">
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Name"><Input value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="Channel"><Select value={f.channel} onChange={(e) => set("channel", e.target.value)}>{CHANNELS.map((c) => <option key={c} value={c}>{formatEnumLabel(c)}</option>)}</Select></Field>
        <Field label="Language"><Select value={f.language} onChange={(e) => set("language", e.target.value)}><option value="EN">English</option><option value="UR">Urdu</option></Select></Field>
        <Field label="Message type"><Select value={f.messageType} onChange={(e) => set("messageType", e.target.value)}>{["TRANSACTIONAL", "SECURITY", "VERIFICATION", "PROPOSAL", "MATCHING", "MEETING", "SUPPORT", "FAMILY", "PAYMENT", "PRIVACY", "SYSTEM", "MARKETING"].map((c) => <option key={c} value={c}>{formatEnumLabel(c)}</option>)}</Select></Field>
        <Field label="Purpose"><Select value={f.purpose} onChange={(e) => set("purpose", e.target.value)}>{["ACCOUNT", "OTP", "VERIFICATION", "PROFILE", "MATCH", "PROPOSAL", "CONTACT_PERMISSION", "MEETING", "FOLLOWUP", "SUPPORT", "PAYMENT", "PRIVACY", "SECURITY", "FAMILY_ACCESS", "MARKETING"].map((c) => <option key={c} value={c}>{formatEnumLabel(c)}</option>)}</Select></Field>
        <Field label="Replaces event (optional)" hint="A notification type, e.g. PROPOSAL_RECEIVED"><Input value={f.eventKey} onChange={(e) => set("eventKey", e.target.value.trim())} /></Field>
      </div>
      <Field label="Subject (e-mail)"><Input value={f.subject} onChange={(e) => set("subject", e.target.value)} /></Field>
      <Field label="Body" hint={`Allowed variables: ${allowed.map((v) => `{{${v}}}`).join(", ")}. No contact details, notes or scores can ever be used.`}><Textarea rows={5} value={f.body} onChange={(e) => set("body", e.target.value)} /></Field>
      <Button onClick={submit}>Create draft</Button>
    </Card>
  );
}

// ------------------------------------------------------------------ Campaigns
interface CampaignRow { id: string; campaignCode: string; name: string; channel: string; messageType: string; status: string; estimatedRecipients: number | null; scheduledAt: string | null; createdAt: string }

function CampaignsTab({ can }: { can: (p: string) => boolean }) {
  const { data, error, loading, reload } = useApi<{ items: CampaignRow[]; filterFields: string[]; maxRecipients: number; approvalThreshold: number }>("/api/admin/communications/campaigns");
  const { show } = useToast();
  const [creating, setCreating] = useState(false);
  const [preview, setPreview] = useState<{ id: string; text: string } | null>(null);

  async function act(id: string, action: string, body: Record<string, unknown> = {}) {
    const r = await callApi<{ approvalRequired?: boolean; approvalCode?: string }>(`/api/admin/communications/campaigns/${id}/${action}`, "POST", body);
    if (!r.ok) show(r.data.error ?? `Could not ${action}`, "error");
    else if (r.data.approvalRequired) show(`Sent for approval (${r.data.approvalCode})`, "success");
    else { show(`Campaign ${action} done`, "success"); reload(); }
  }
  async function doPreview(id: string) {
    const r = await callApi<{ estimatedRecipients?: number; sampled?: number; sampleEligible?: number; sampleBlockedByReason?: Record<string, number> }>(`/api/admin/communications/campaigns/${id}/preview`, "POST", {});
    if (!r.ok) return show(r.data.error ?? "Could not preview", "error");
    const blocked = Object.entries(r.data.sampleBlockedByReason ?? {}).map(([k, v]) => `${k.replace("BLOCKED_", "").toLowerCase()}: ${v}`).join(", ");
    setPreview({ id, text: `About ${r.data.estimatedRecipients} people match. In a sample of ${r.data.sampled}, ${r.data.sampleEligible} could be messaged${blocked ? ` (held back — ${blocked})` : ""}.` });
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">Every recipient is checked individually (consent, suppression, jurisdiction, frequency). Campaigns of {data?.approvalThreshold ?? 50}+ people and all marketing need approval, and the approver cannot be the creator.</p>
        {can("communications:campaigns:create") && <Button onClick={() => setCreating((v) => !v)}>{creating ? "Close" : "New campaign"}</Button>}
      </div>
      {creating && data && <CampaignForm fields={data.filterFields} onDone={() => { setCreating(false); reload(); }} />}
      {loading && !data && <Loading />}
      {error && <ErrorNote message={error} />}
      {data && data.items.length === 0 && <EmptyState title="No campaigns" description="Campaigns are switched off by default (feature flag communications.campaigns.enabled)." />}
      {data && data.items.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {data.items.map((c) => (
            <li key={c.id} className="space-y-2 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs">{c.campaignCode}</span><span className="font-medium">{c.name}</span>
                  <Badge>{formatEnumLabel(c.channel)}</Badge><StatusBadge status={c.status} />
                  <span className="text-xs text-muted">~{c.estimatedRecipients ?? 0} recipients</span>
                </span>
                <span className="flex flex-wrap gap-1">
                  <Button size="sm" variant="ghost" onClick={() => doPreview(c.id)}>Preview audience</Button>
                  {c.status === "DRAFT" && can("communications:campaigns:create") && <Button size="sm" variant="secondary" onClick={() => act(c.id, "submit")}>Submit</Button>}
                  {c.status === "REVIEW" && can("communications:campaigns:approve") && <Button size="sm" variant="secondary" onClick={() => act(c.id, "approve")}>Approve</Button>}
                  {["APPROVED", "SCHEDULED", "PAUSED"].includes(c.status) && can("communications:campaigns:manage") && <Button size="sm" onClick={() => act(c.id, "start")}>Start</Button>}
                  {c.status === "RUNNING" && can("communications:campaigns:manage") && <Button size="sm" variant="secondary" onClick={() => act(c.id, "pause")}>Pause</Button>}
                  {!["COMPLETED", "CANCELLED"].includes(c.status) && can("communications:campaigns:manage") && <Button size="sm" variant="danger" onClick={() => { const reason = window.prompt("Reason for cancelling (required)"); if (reason) act(c.id, "cancel", { reason }); }}>Cancel</Button>}
                </span>
              </div>
              {preview?.id === c.id && <p className="rounded border border-border bg-surface-muted p-2 text-xs">{preview.text}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CampaignForm({ fields, onDone }: { fields: string[]; onDone: () => void }) {
  const { show } = useToast();
  const templates = useApi<{ items: TemplateRow[] }>("/api/admin/communications/templates?status=ACTIVE");
  const [f, setF] = useState({ name: "", purpose: "FOLLOWUP", messageType: "TRANSACTIONAL", channel: "EMAIL", templateId: "" });
  const [rules, setRules] = useState<{ field: string; op: string; value: string }[]>([{ field: fields[0] ?? "status", op: "eq", value: "" }]);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  async function submit() {
    const audienceFilter = { op: "AND", rules: rules.filter((r) => r.value.trim()).map((r) => ({ field: r.field, op: r.op, value: r.value.trim() })) };
    const r = await callApi("/api/admin/communications/campaigns", "POST", { ...f, audienceFilter });
    if (!r.ok) show(r.data.error ?? "Could not create the campaign", "error");
    else { show("Campaign saved as a draft", "success"); onDone(); }
  }
  const usable = (templates.data?.items ?? []).filter((t) => t.channel === f.channel && t.messageType === f.messageType);
  return (
    <Card title="New campaign">
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Name"><Input value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="Channel"><Select value={f.channel} onChange={(e) => set("channel", e.target.value)}>{["EMAIL", "SMS", "WHATSAPP"].map((c) => <option key={c} value={c}>{formatEnumLabel(c)}</option>)}</Select></Field>
        <Field label="Message type"><Select value={f.messageType} onChange={(e) => set("messageType", e.target.value)}>{["TRANSACTIONAL", "PROPOSAL", "MEETING", "SUPPORT", "MARKETING"].map((c) => <option key={c} value={c}>{formatEnumLabel(c)}</option>)}</Select></Field>
        <Field label="Purpose"><Select value={f.purpose} onChange={(e) => set("purpose", e.target.value)}>{["FOLLOWUP", "ACCOUNT", "PROFILE", "SUPPORT", "PROPOSAL", "MEETING", "MARKETING"].map((c) => <option key={c} value={c}>{formatEnumLabel(c)}</option>)}</Select></Field>
        <Field label="Active template" hint="Must match the channel and message type"><Select value={f.templateId} onChange={(e) => set("templateId", e.target.value)}><option value="">Select…</option>{usable.map((t) => <option key={t.id} value={t.id}>{t.templateCode} — {t.name}</option>)}</Select></Field>
      </div>
      <div className="space-y-2">
        <div className="text-sm font-medium">Audience (all conditions must match)</div>
        <p className="text-xs text-muted">Only these fields can be used: {fields.join(", ")}. Sensitive traits (religion, caste, income and similar) can never be used to target people.</p>
        {rules.map((r, i) => (
          <div key={i} className="flex flex-wrap gap-2">
            <Select value={r.field} onChange={(e) => setRules((p) => p.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))} className="w-44">{fields.map((x) => <option key={x} value={x}>{x}</option>)}</Select>
            <Select value={r.op} onChange={(e) => setRules((p) => p.map((x, j) => (j === i ? { ...x, op: e.target.value } : x)))} className="w-32"><option value="eq">is</option><option value="neq">is not</option><option value="contains">contains</option></Select>
            <Input value={r.value} onChange={(e) => setRules((p) => p.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} className="w-56" placeholder="value" />
          </div>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setRules((p) => [...p, { field: fields[0] ?? "status", op: "eq", value: "" }])}>Add condition</Button>
      </div>
      <Button onClick={submit} disabled={!f.templateId || !f.name.trim()}>Save draft</Button>
    </Card>
  );
}

// ------------------------------------------------------------------ Providers
interface ProviderRow { id: string; providerKey: string; name: string; channel: string; adapter: string; environment: string; active: boolean; priority: number; failoverAllowed: boolean; healthStatus: string; lastError: string | null; credentials: { name: string; configured: boolean }[]; configured: boolean }
interface ProvidersData { environment: string; providers: ProviderRow[]; builtins: { channel: string; adapter: string; configured: boolean; effective: string }[]; health: { providerKey: string; sent24h: number; failed24h: number; failureRate24h: number | null; avgLatencySeconds: number | null; alerts: string[] }[] }

function ProvidersTab({ canManage }: { canManage: boolean }) {
  const { data, error, loading, reload } = useApi<ProvidersData>("/api/admin/communications/providers");
  const { show } = useToast();
  async function probe(id: string) {
    const r = await callApi<{ status?: string }>(`/api/admin/communications/providers/${id}/probe`, "POST", {});
    if (!r.ok) show(r.data.error ?? "Probe failed", "error");
    else { show(`Provider health: ${r.data.status}`, "success"); reload(); }
  }
  async function toggle(p: ProviderRow) {
    const r = await callApi<{ approvalRequired?: boolean; approvalCode?: string }>(`/api/admin/communications/providers/${p.id}`, "PATCH", { active: !p.active });
    if (!r.ok) show(r.data.error ?? "Could not change the provider", "error");
    else if (r.data.approvalRequired) show(`Sent for approval (${r.data.approvalCode})`, "success");
    else { show("Provider updated", "success"); reload(); }
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Credentials live in server environment variables only. This page shows which are configured — never their values. Turning a provider on or changing its routing needs approval.</p>
      {loading && !data && <Loading />}
      {error && <ErrorNote message={error} />}
      {data && (
        <>
          <Card title={`Environment: ${formatEnumLabel(data.environment)}`}>
            <ul className="space-y-1 text-sm">
              {data.builtins.map((b) => (
                <li key={b.channel} className="flex flex-wrap items-center gap-2">
                  <Badge>{formatEnumLabel(b.channel)}</Badge>
                  <span>default adapter {b.adapter}</span>
                  <Badge variant={b.configured ? "success" : "warning"}>{b.configured ? "credentials set" : "not configured"}</Badge>
                  <span className="text-xs text-muted">currently delivered via {b.effective === "SANDBOX" ? "the sandbox (nothing leaves the system)" : b.effective}</span>
                </li>
              ))}
            </ul>
          </Card>
          {data.providers.length === 0 && <EmptyState title="No provider rows" description="Built-in defaults above are used until a provider is configured." />}
          {data.providers.map((p) => {
            const h = data.health.find((x) => x.providerKey === p.providerKey);
            return (
              <Card key={p.id} title={`${p.name} (${p.providerKey})`} action={canManage ? <span className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => probe(p.id)}>Check health</Button><Button size="sm" variant="secondary" onClick={() => toggle(p)}>{p.active ? "Deactivate" : "Activate"}</Button></span> : undefined}>
                <div className="grid gap-2 text-sm md:grid-cols-4">
                  <KV label="Channel">{formatEnumLabel(p.channel)}</KV>
                  <KV label="State">{p.active ? "Active" : "Inactive"} · priority {p.priority}{p.failoverAllowed ? " · failover allowed" : ""}</KV>
                  <KV label="Health"><StatusBadge status={p.healthStatus} /></KV>
                  <KV label="24 h">{h ? `${h.sent24h} sent, ${h.failed24h} failed${h.avgLatencySeconds !== null ? `, ${h.avgLatencySeconds}s avg` : ""}` : "—"}</KV>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">{p.credentials.map((c) => <Badge key={c.name} variant={c.configured ? "success" : "warning"}>{c.name}: {c.configured ? "set" : "missing"}</Badge>)}</div>
                {h && h.alerts.length > 0 && <p className="mt-2 text-xs text-danger">Alerts: {h.alerts.map(formatEnumLabel).join(", ")}</p>}
                {p.lastError && <p className="mt-1 text-xs text-muted">Last error: {p.lastError}</p>}
              </Card>
            );
          })}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Suppressions
interface SuppressionRow { id: string; channel: string; reason: string; scope: string; status: string; profileId: string | null; hasAddress: boolean; expiresAt: string | null; createdAt: string }

function SuppressionsTab({ canSuppress }: { canSuppress: boolean }) {
  const { data, error, loading, reload } = useApi<{ items: SuppressionRow[] }>("/api/admin/communications/suppressions?status=ACTIVE");
  const { show } = useToast();
  async function lift(id: string) {
    const reason = window.prompt("Reason for lifting this suppression (required, audited)");
    if (!reason) return;
    const r = await callApi(`/api/admin/communications/suppressions/${id}/lift`, "POST", { reason });
    if (!r.ok) show(r.data.error ?? "Could not lift", "error");
    else { show("Suppression lifted", "success"); reload(); }
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">People and addresses that must not be messaged (bounces, complaints, opt-outs, restrictions). Addresses are stored only as salted hashes. Lifting one is deliberate and audited.</p>
      {loading && !data && <Loading />}
      {error && <ErrorNote message={error} />}
      {data && data.items.length === 0 && <EmptyState title="No active suppressions" />}
      {data && data.items.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {data.items.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <span className="flex flex-wrap items-center gap-2"><Badge>{formatEnumLabel(s.channel)}</Badge><Badge variant="warning">{formatEnumLabel(s.reason)}</Badge><span className="text-muted">scope {s.scope.toLowerCase()}</span><span className="text-xs text-muted">{timeAgo(s.createdAt)}{s.expiresAt ? ` · expires ${formatDateTime(s.expiresAt)}` : ""}</span></span>
              {canSuppress && <Button size="sm" variant="secondary" onClick={() => lift(s.id)}>Lift</Button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Analytics
interface AnalyticsData { totals: Record<string, number>; rates: Record<string, number | null>; latency: { avgSecondsToSent: number | null; p95SecondsToSent: number | null; samples: number }; byChannel: Record<string, { sent: number; delivered: number; failed: number }>; byProvider: Record<string, { sent: number; delivered: number; failed: number }>; blockedByReason: Record<string, number>; suppressions: { added: number; active: number }; followUps: { created: number; completed: number; completionRate: number | null } }

const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Math.round(v * 100)}%`);

function AnalyticsTab({ canExport }: { canExport: boolean }) {
  const { data, error, loading } = useApi<AnalyticsData>("/api/admin/communications/analytics");
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">Last 30 days, aggregates only. Delivered and read are counted only when a provider reported them; sandbox traffic is excluded from rates.</p>
        {canExport && <a className="text-sm text-primary hover:underline" href="/api/admin/communications/analytics?format=csv">Export CSV</a>}
      </div>
      {loading && !data && <Loading />}
      {error && <ErrorNote message={error} />}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[["Messages", data.totals.messages], ["Sent", data.totals.sent], ["Delivered (reported)", data.totals.delivered], ["Failed", data.totals.failed], ["Bounced", data.totals.bounced], ["Queued", data.totals.queued], ["Dead-lettered", data.totals.deadLettered], ["Sandbox only", data.totals.sandboxOnly]].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border border-border bg-surface p-3"><div className="text-xs text-muted">{label}</div><div className="text-xl font-semibold">{value as number}</div></div>
            ))}
          </div>
          <Card title="Rates & latency">
            <div className="grid gap-2 text-sm md:grid-cols-4">
              <KV label="Delivery (of reported)">{pct(data.rates.deliveryRateOfReported)}</KV>
              <KV label="Failure">{pct(data.rates.failureRate)}</KV>
              <KV label="Read (of delivered)">{pct(data.rates.readRateOfDelivered)}</KV>
              <KV label="Time to send (avg / p95)">{data.latency.avgSecondsToSent ?? "—"}s / {data.latency.p95SecondsToSent ?? "—"}s</KV>
              <KV label="Suppressions added / active">{data.suppressions.added} / {data.suppressions.active}</KV>
              <KV label="Follow-up tasks completed">{data.followUps.completed} of {data.followUps.created} ({pct(data.followUps.completionRate)})</KV>
            </div>
          </Card>
          <Card title="By channel">
            <ul className="text-sm">{Object.entries(data.byChannel).map(([k, v]) => <li key={k}>{formatEnumLabel(k)}: {v.sent} sent, {v.delivered} delivered, {v.failed} failed</li>)}{Object.keys(data.byChannel).length === 0 && <li className="text-muted">No external messages in this period.</li>}</ul>
          </Card>
          <Card title="Held back by policy">
            <ul className="text-sm">{Object.entries(data.blockedByReason).map(([k, v]) => <li key={k}>{k.replace("BLOCKED_", "").replace(/_/g, " ").toLowerCase()}: {v}</li>)}{Object.keys(data.blockedByReason).length === 0 && <li className="text-muted">Nothing was held back.</li>}</ul>
          </Card>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Policies (read-only view)
function PoliciesTab() {
  const { data, error, loading } = useApi<{ policies: Record<string, { config: unknown; version: number }>; followUpRules: Record<string, { enabled: boolean; waitDays: number; cooldownDays: number; maxRepeats: number; createTask: boolean; notifyUser: boolean }> }>("/api/admin/communications/policies");
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">The effective, versioned policies the engine applies. Changes are made through the audited policy API and always create a new version.</p>
      {loading && !data && <Loading />}
      {error && <ErrorNote message={error} />}
      {data && (
        <>
          {Object.entries(data.policies).map(([k, v]) => (
            <Card key={k} title={`${formatEnumLabel(k)} · v${v.version}`}><pre className="overflow-x-auto text-xs">{JSON.stringify(v.config, null, 2)}</pre></Card>
          ))}
          <Card title="Follow-up automation rules (all ship disabled)">
            <ul className="space-y-1 text-sm">{Object.entries(data.followUpRules).map(([k, r]) => <li key={k} className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs">{k}</span><Badge variant={r.enabled ? "success" : "default"}>{r.enabled ? "enabled" : "disabled"}</Badge><span className="text-xs text-muted">after {r.waitDays}d, every {r.cooldownDays}d, max {r.maxRepeats}{r.notifyUser ? ", notifies applicant" : ""}</span></li>)}</ul>
          </Card>
        </>
      )}
    </div>
  );
}
