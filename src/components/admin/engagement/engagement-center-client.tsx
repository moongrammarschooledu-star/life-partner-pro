"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Tabs } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { Card, ErrorNote, KV, Loading, StatusBadge, timeAgo, useApi } from "@/components/admin/system/shared";
import { act } from "@/components/admin/marketing/shared";

// Admin -> Engagement Center. A shell over the STEP 30 APIs: every call enforces its own permission on the server; the tabs and
// buttons here only mirror what the viewer may do. Nothing on this screen shows a quality, compatibility or outcome measure.

const EVENT_TYPES = [
  "USER_REGISTERED", "PROFILE_STARTED", "PROFILE_COMPLETED", "PROFILE_SUBMITTED", "VERIFICATION_STARTED", "VERIFICATION_COMPLETED", "PROFILE_ACTIVATED", "PROPOSAL_RECEIVED",
  "PROPOSAL_RESPONSE_RECEIVED", "MUTUAL_INTEREST", "MEETING_REQUESTED", "MEETING_SCHEDULED", "MEETING_COMPLETED", "SUPPORT_CASE_CREATED", "MEMBERSHIP_STARTED", "MEMBERSHIP_EXPIRING",
  "INACTIVE_USER", "REENGAGEMENT_ELIGIBLE", "LOGIN",
];
const STARTER = JSON.stringify({ conditions: {}, cancelOn: [], steps: [{ type: "WAIT", hours: 72 }, { type: "RECHECK_ELIGIBLE" }, { type: "NOTIFY_APPLICANT", kind: "PROFILE_INCOMPLETE" }] }, null, 2);
const CATEGORIES = ["getting-started", "profile", "verification", "matching", "proposals", "family", "meetings", "privacy", "safety", "membership", "support"];

type Can = (p: string) => boolean;

export function EngagementCenterClient({ permissions }: { permissions: string[] }) {
  const can: Can = (p) => permissions.includes(p);
  const tabs = [
    { value: "overview", label: "Overview", show: true },
    { value: "automations", label: "Automations", show: can("engagement:workflows:view") },
    { value: "reminders", label: "Reminders", show: can("engagement:reminders:view") },
    { value: "content", label: "Guide content", show: can("engagement:content:view") },
    { value: "announcements", label: "Announcements", show: can("engagement:announcements:view") },
    { value: "feedback", label: "Feedback & surveys", show: can("engagement:feedback:view") },
    { value: "analytics", label: "Analytics", show: can("engagement:analytics:view") },
    { value: "settings", label: "Settings", show: true },
    { value: "audit", label: "Audit log", show: can("engagement:audit:view") },
    { value: "ai", label: "Assistant", show: can("ai:engagement:use") },
  ].filter((t) => t.show);
  const [tab, setTab] = useState("overview");
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Engagement Center</h1>
        <p className="text-sm text-muted">Reminders, lifecycle automations, guide content, announcements and feedback — consent, preferences, limits and review built in. Nothing here predicts outcomes or pressures anyone.</p>
      </div>
      <Tabs tabs={tabs.map(({ value, label }) => ({ value, label }))} value={tab} onChange={setTab} />
      {tab === "overview" && <OverviewTab can={can} />}
      {tab === "automations" && <AutomationsTab can={can} />}
      {tab === "reminders" && <RemindersTab can={can} />}
      {tab === "content" && <ContentTab can={can} />}
      {tab === "announcements" && <AnnouncementsTab can={can} />}
      {tab === "feedback" && <FeedbackTab can={can} />}
      {tab === "analytics" && <AnalyticsTab can={can} />}
      {tab === "settings" && <SettingsTab can={can} />}
      {tab === "audit" && <AuditTab />}
      {tab === "ai" && <AssistantTab />}
    </div>
  );
}

// ---------------------------------------------------------------- Overview
interface OverviewData {
  overview: {
    windowDays: number; events: Record<string, number>; activityStates: Record<string, number>; reminders: Record<string, number>; runs: Record<string, number>;
    workflows: Record<string, number>; feedback: Record<string, number>; announcements: Record<string, number>; reengagementResponseRate: number | null; reengagementNote: string | null;
    notifications: { sent: number; read: number; readRate: number | null };
  };
  flags: Record<string, boolean>;
}

function Counts({ data }: { data: Record<string, number> }) {
  const rows = Object.entries(data);
  if (!rows.length) return <p className="text-sm text-muted">Nothing recorded yet.</p>;
  return <dl>{rows.map(([k, v]) => <KV key={k} label={k.replace(/_/g, " ").toLowerCase()}>{v}</KV>)}</dl>;
}

function OverviewTab({ can }: { can: Can }) {
  const { show } = useToast();
  const { data, error, loading, reload } = useApi<OverviewData>("/api/admin/engagement/overview?days=30");
  const [busy, setBusy] = useState(false);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? "Could not load."} />;
  const o = data.overview;
  const off = !data.flags.master;
  async function run() {
    setBusy(true);
    const ok = await act(show, "/api/admin/engagement/tick", "POST", {}, "The engagement run finished.");
    setBusy(false);
    if (ok) reload();
  }
  return (
    <div className="space-y-4">
      {off && <div className="rounded-xl border border-warning/40 bg-warning/5 p-4 text-sm">Engagement is switched off. Nothing is recorded or sent until an administrator turns on <code>engagement.enabled</code> (and the parts below) in Feature Flags.</div>}
      <Card title="Switches">
        <dl>{Object.entries(data.flags).map(([k, v]) => <KV key={k} label={k.replace(/([A-Z])/g, " $1").toLowerCase()}>{v ? "On" : "Off"}</KV>)}</dl>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title={`Activity recorded (last ${o.windowDays} days)`}><Counts data={o.events} /></Card>
        <Card title="Activity bands"><Counts data={o.activityStates} /></Card>
        <Card title="Reminders"><Counts data={o.reminders} />
          <p className="mt-2 text-xs text-muted">{o.reengagementResponseRate === null ? o.reengagementNote : `Of reminders sent, ${o.reengagementResponseRate}% led to the thing being done.`}</p>
        </Card>
        <Card title="Automation runs"><Counts data={o.runs} /></Card>
        <Card title="Workflows"><Counts data={o.workflows} /></Card>
        <Card title="Feedback"><Counts data={o.feedback} /></Card>
      </div>
      <Card title="Engagement notifications">
        <p className="text-sm">{o.notifications.sent} sent, {o.notifications.read} read{o.notifications.readRate === null ? " (not enough data for a rate)" : ` (${o.notifications.readRate}%)`}.</p>
      </Card>
      {can("engagement:manage") && <Button onClick={run} disabled={busy}>{busy ? "Running…" : "Run the daily engagement job now"}</Button>}
    </div>
  );
}

// ---------------------------------------------------------------- Automations
interface WfRow { id: string; code: string; name: string; description: string | null; trigger: string; status: string; latestVersion: { version: number; status: string } | null; runs: number }
interface WfDetail { workflow: { id: string; name: string; trigger: string; status: string; versions: Array<{ version: number; status: string; definition: unknown; authorId: string; reviewerId: string | null; changeSummary: string | null }> }; runStats: Array<{ status: string; count: number }> }

function AutomationsTab({ can }: { can: Can }) {
  const { show } = useToast();
  const { data, error, loading, reload } = useApi<{ items: WfRow[] }>("/api/admin/engagement/workflows");
  const [sel, setSel] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("PROFILE_STARTED");
  const [def, setDef] = useState(STARTER);

  async function create() {
    let definition: unknown;
    try {
      definition = JSON.parse(def);
    } catch {
      return show("The definition is not valid JSON.", "error");
    }
    if (await act(show, "/api/admin/engagement/workflows", "POST", { name, trigger, definition }, "Workflow saved as a draft.")) {
      setName("");
      reload();
    }
  }
  async function action(id: string, a: string, body: Record<string, unknown>, ok: string) {
    if (await act(show, `/api/admin/engagement/workflows/${id}/${a}`, "POST", body, ok)) reload();
  }
  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? "Could not load."} />;
  return (
    <div className="space-y-4">
      <Card title="Lifecycle automations" action={can("engagement:workflows:create") ? <Button size="sm" variant="outline" onClick={async () => { if (await act(show, "/api/admin/engagement/workflows/install-defaults", "POST", {}, "Standard automations installed as drafts.")) reload(); }}>Install standard automations (as drafts)</Button> : undefined}>
        {data.items.length === 0 ? <EmptyState title="No automations yet" description="Install the standard set as drafts, review them, and publish each one." /> : (
          <ul className="divide-y divide-border">
            {data.items.map((w) => (
              <li key={w.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <button type="button" className="font-medium text-primary hover:underline" onClick={() => setSel(sel === w.id ? null : w.id)}>{w.name}</button>
                    <p className="text-xs text-muted">{w.code} · when {w.trigger.replace(/_/g, " ").toLowerCase()} · {w.runs} runs</p>
                  </div>
                  <div className="flex items-center gap-2"><StatusBadge status={w.status} />{w.latestVersion && <span className="text-xs text-muted">v{w.latestVersion.version} <StatusBadge status={w.latestVersion.status} /></span>}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {w.latestVersion && ["DRAFT", "REJECTED"].includes(w.latestVersion.status) && can("engagement:workflows:edit") && <Button size="sm" variant="outline" onClick={() => action(w.id, "submit", { version: w.latestVersion!.version }, "Submitted for review.")}>Submit for review</Button>}
                  {w.latestVersion?.status === "REVIEW" && can("engagement:approve") && <>
                    <Button size="sm" variant="outline" onClick={() => action(w.id, "review", { version: w.latestVersion!.version, decision: "APPROVE" }, "Approved.")}>Approve</Button>
                    <Button size="sm" variant="outline" onClick={() => { const reason = window.prompt("Reason for rejecting"); if (reason) void action(w.id, "review", { version: w.latestVersion!.version, decision: "REJECT", reason }, "Rejected."); }}>Reject</Button>
                  </>}
                  {w.latestVersion?.status === "APPROVED" && can("engagement:workflows:publish") && <Button size="sm" onClick={() => { const reason = window.prompt("Reason for publishing"); if (reason) void action(w.id, "publish", { version: w.latestVersion!.version, reason }, "Published."); }}>Publish</Button>}
                  {w.status === "PUBLISHED" && can("engagement:workflows:pause") && <Button size="sm" variant="outline" onClick={() => { const reason = window.prompt("Reason for pausing"); if (reason) void action(w.id, "pause", { reason }, "Paused."); }}>Pause</Button>}
                  {w.status === "PAUSED" && can("engagement:workflows:pause") && <Button size="sm" variant="outline" onClick={() => { const reason = window.prompt("Reason for resuming"); if (reason) void action(w.id, "resume", { reason }, "Resumed."); }}>Resume</Button>}
                  {w.status !== "ARCHIVED" && can("engagement:workflows:publish") && <Button size="sm" variant="outline" onClick={() => { const reason = window.prompt("Reason for archiving"); if (reason) void action(w.id, "archive", { reason }, "Archived."); }}>Archive</Button>}
                </div>
                {sel === w.id && <WorkflowDetailPanel id={w.id} can={can} onSaved={reload} onRollback={(version) => { const reason = window.prompt("Reason for rolling back"); if (reason) void action(w.id, "rollback", { version, reason }, "A new draft was created from that version."); }} />}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {can("engagement:workflows:create") && (
        <Card title="New automation">
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
              <Field label="Starts when"><Select value={trigger} onChange={(e) => setTrigger(e.target.value)}>{EVENT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ").toLowerCase()}</option>)}</Select></Field>
            </div>
            <Field label="Definition" hint="Only the listed conditions and steps are accepted. Scores, risk signals and protected attributes cannot be used.">
              <Textarea value={def} onChange={(e) => setDef(e.target.value)} rows={10} className="font-mono text-xs" />
            </Field>
            <Button onClick={create} disabled={name.trim().length < 3}>Save as draft</Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function WorkflowDetailPanel({ id, can, onSaved, onRollback }: { id: string; can: Can; onSaved: () => void; onRollback: (v: number) => void }) {
  const { show } = useToast();
  const { data, error, loading, reload } = useApi<WfDetail>(`/api/admin/engagement/workflows/${id}`);
  const [text, setText] = useState<string | null>(null);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? "Could not load."} />;
  const latest = data.workflow.versions[0];
  const shown = text ?? JSON.stringify(latest?.definition ?? {}, null, 2);
  async function save() {
    let definition: unknown;
    try {
      definition = JSON.parse(shown);
    } catch {
      return show("The definition is not valid JSON.", "error");
    }
    if (await act(show, `/api/admin/engagement/workflows/${id}`, "PATCH", { definition, changeSummary: "Edited" }, "Draft saved. It needs review again before it can be published.")) {
      setText(null);
      reload();
      onSaved();
    }
  }
  return (
    <div className="space-y-3 rounded-lg border border-border bg-background p-3">
      <div className="flex flex-wrap gap-3 text-xs text-muted">{data.runStats.map((r) => <span key={r.status}>{r.status.toLowerCase()}: {r.count}</span>)}</div>
      <Textarea value={shown} onChange={(e) => setText(e.target.value)} rows={10} className="font-mono text-xs" readOnly={!can("engagement:workflows:edit")} />
      {can("engagement:workflows:edit") && <Button size="sm" onClick={save}>Save as new draft</Button>}
      <ul className="space-y-1 text-xs">
        {data.workflow.versions.map((v) => (
          <li key={v.version} className="flex items-center justify-between gap-2">
            <span>Version {v.version} <StatusBadge status={v.status} />{v.changeSummary ? ` — ${v.changeSummary}` : ""}</span>
            {["APPROVED", "SUPERSEDED"].includes(v.status) && can("engagement:workflows:publish") && <Button size="sm" variant="outline" onClick={() => onRollback(v.version)}>Roll back to this</Button>}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- Reminders
interface ReminderRow { id: string; profileId: string; kind: string; state: string; dueAt: string; sentAt: string | null; attempt: number; cancelReason: string | null }
function RemindersTab({ can }: { can: Can }) {
  const { show } = useToast();
  const [state, setState] = useState("");
  const { data, error, loading, reload } = useApi<{ items: ReminderRow[] }>(`/api/admin/engagement/reminders${state ? `?state=${state}` : ""}`);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? "Could not load."} />;
  return (
    <Card title="Reminders and re-engagement" action={<Select value={state} onChange={(e) => setState(e.target.value)} className="w-40"><option value="">All</option>{["SCHEDULED", "SENT", "RESPONDED", "CANCELLED", "OPTED_OUT", "SUPPRESSED", "EXPIRED"].map((s) => <option key={s} value={s}>{s.toLowerCase().replace(/_/g, " ")}</option>)}</Select>}>
      {data.items.length === 0 ? <EmptyState title="No reminders" /> : (
        <ul className="divide-y divide-border text-sm">
          {data.items.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <span className="font-medium">{r.kind.replace(/_/g, " ").toLowerCase()}</span> <span className="text-xs text-muted">attempt {r.attempt} · due {timeAgo(r.dueAt)}{r.cancelReason ? ` · ${r.cancelReason.toLowerCase().replace(/_/g, " ")}` : ""}</span>
                <p className="text-xs text-muted"><a className="text-primary hover:underline" href={`/admin/engagement/users/${r.profileId}`}>Open applicant engagement</a></p>
              </div>
              <div className="flex items-center gap-2"><StatusBadge status={r.state} />
                {["SCHEDULED", "ELIGIBLE"].includes(r.state) && can("engagement:reminders:manage") && <Button size="sm" variant="outline" onClick={async () => { const reason = window.prompt("Reason for cancelling"); if (reason && (await act(show, `/api/admin/engagement/reminders/${r.id}/cancel`, "POST", { reason }, "Cancelled."))) reload(); }}>Cancel</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- Content
interface ContentRow { id: string; code: string; slug: string; category: string; status: string; latestVersion: { version: number; status: string; title: string; language: string } | null }
function ContentTab({ can }: { can: Can }) {
  const { show } = useToast();
  const { data, error, loading, reload } = useApi<{ items: ContentRow[] }>("/api/admin/engagement/content");
  const [f, setF] = useState({ slug: "", category: "getting-started", title: "", description: "", body: "", language: "EN" });
  async function create() {
    if (await act(show, "/api/admin/engagement/content", "POST", f, "Article saved as a draft.")) {
      setF({ ...f, slug: "", title: "", description: "", body: "" });
      reload();
    }
  }
  async function step(id: string, a: string, body: Record<string, unknown>, ok: string) {
    if (await act(show, `/api/admin/engagement/content/${id}/${a}`, "POST", body, ok)) reload();
  }
  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? "Could not load."} />;
  return (
    <div className="space-y-4">
      <Card title="Guide articles">
        {data.items.length === 0 ? <EmptyState title="No articles yet" /> : (
          <ul className="divide-y divide-border text-sm">
            {data.items.map((c) => (
              <li key={c.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><span className="font-medium">{c.latestVersion?.title ?? c.slug}</span> <span className="text-xs text-muted">{c.code} · {c.category} · {c.latestVersion?.language}</span></div>
                  <div className="flex items-center gap-2"><StatusBadge status={c.status} />{c.latestVersion && <StatusBadge status={c.latestVersion.status} />}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {c.latestVersion && ["DRAFT", "REJECTED"].includes(c.latestVersion.status) && can("engagement:content:edit") && <Button size="sm" variant="outline" onClick={() => step(c.id, "submit", { version: c.latestVersion!.version }, "Submitted for review.")}>Submit for review</Button>}
                  {c.latestVersion?.status === "REVIEW" && can("engagement:approve") && <>
                    <Button size="sm" variant="outline" onClick={() => step(c.id, "review", { version: c.latestVersion!.version, decision: "APPROVE" }, "Approved.")}>Approve</Button>
                    <Button size="sm" variant="outline" onClick={() => { const reason = window.prompt("Reason for rejecting"); if (reason) void step(c.id, "review", { version: c.latestVersion!.version, decision: "REJECT", reason }, "Rejected."); }}>Reject</Button>
                  </>}
                  {c.latestVersion?.status === "APPROVED" && can("engagement:content:publish") && <Button size="sm" onClick={() => { const reason = window.prompt("Reason for publishing"); if (reason) void step(c.id, "publish", { version: c.latestVersion!.version, reason }, "Published."); }}>Publish</Button>}
                  {c.status === "PUBLISHED" && can("engagement:content:publish") && <Button size="sm" variant="outline" onClick={() => { const reason = window.prompt("Reason for unpublishing"); if (reason) void step(c.id, "unpublish", { reason }, "Unpublished."); }}>Unpublish</Button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {can("engagement:content:create") && (
        <Card title="New article">
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Slug"><Input value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} placeholder="how-verification-works" /></Field>
              <Field label="Topic"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
              <Field label="Language"><Select value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}><option value="EN">English</option><option value="UR">Urdu</option></Select></Field>
            </div>
            <Field label="Title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={160} /></Field>
            <Field label="Summary (optional)"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={300} /></Field>
            <Field label="Article text" hint="Plain text only. Separate paragraphs with a blank line."><Textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} rows={8} dir={f.language === "UR" ? "rtl" : "ltr"} /></Field>
            <Button onClick={create} disabled={!f.slug || f.title.trim().length < 3 || f.body.trim().length < 20}>Save as draft</Button>
          </div>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Announcements
interface AnnRow { id: string; code: string; title: string; language: string; status: string; targeting: { audience: string; value?: string }; startAt: string | null; endAt: string | null; dismissals: number }
function AnnouncementsTab({ can }: { can: Can }) {
  const { show } = useToast();
  const { data, error, loading, reload } = useApi<{ items: AnnRow[] }>("/api/admin/engagement/announcements");
  const [f, setF] = useState({ title: "", body: "", language: "EN", audience: "ALL", value: "", startAt: "", endAt: "" });
  async function create() {
    const targeting = f.value ? { audience: f.audience, value: f.value } : { audience: f.audience };
    if (await act(show, "/api/admin/engagement/announcements", "POST", { title: f.title, body: f.body, language: f.language, targeting, startAt: f.startAt || null, endAt: f.endAt || null }, "Announcement saved as a draft.")) {
      setF({ ...f, title: "", body: "" });
      reload();
    }
  }
  async function step(id: string, a: string, body: Record<string, unknown>, ok: string) {
    if (await act(show, `/api/admin/engagement/announcements/${id}/${a}`, "POST", body, ok)) reload();
  }
  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? "Could not load."} />;
  return (
    <div className="space-y-4">
      <Card title="Announcements">
        {data.items.length === 0 ? <EmptyState title="No announcements" /> : (
          <ul className="divide-y divide-border text-sm">
            {data.items.map((a) => (
              <li key={a.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><span className="font-medium">{a.title}</span> <span className="text-xs text-muted">{a.code} · {a.targeting.audience.replace(/_/g, " ").toLowerCase()}{a.targeting.value ? ` (${a.targeting.value})` : ""} · dismissed by {a.dismissals}</span></div>
                  <StatusBadge status={a.status} />
                </div>
                <div className="flex flex-wrap gap-2">
                  {a.status === "DRAFT" && can("engagement:announcements:create") && <Button size="sm" variant="outline" onClick={() => step(a.id, "submit", {}, "Submitted for review.")}>Submit for review</Button>}
                  {a.status === "REVIEW" && can("engagement:approve") && <>
                    <Button size="sm" variant="outline" onClick={() => step(a.id, "review", { decision: "APPROVE" }, "Approved.")}>Approve</Button>
                    <Button size="sm" variant="outline" onClick={() => { const reason = window.prompt("Reason for rejecting"); if (reason) void step(a.id, "review", { decision: "REJECT", reason }, "Sent back to draft."); }}>Reject</Button>
                  </>}
                  {a.status === "APPROVED" && can("engagement:announcements:publish") && <Button size="sm" onClick={() => { const reason = window.prompt("Reason for publishing"); if (reason) void step(a.id, "publish", { reason }, "Published."); }}>Publish</Button>}
                  {!["ARCHIVED", "EXPIRED"].includes(a.status) && can("engagement:announcements:publish") && <Button size="sm" variant="outline" onClick={() => { const reason = window.prompt("Reason for archiving"); if (reason) void step(a.id, "archive", { reason }, "Archived."); }}>Archive</Button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {can("engagement:announcements:create") && (
        <Card title="New announcement">
          <div className="space-y-3">
            <Field label="Title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={160} /></Field>
            <Field label="Message"><Textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} rows={4} maxLength={1200} dir={f.language === "UR" ? "rtl" : "ltr"} /></Field>
            <div className="grid gap-3 md:grid-cols-4">
              <Field label="Language"><Select value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}><option value="EN">English</option><option value="UR">Urdu</option></Select></Field>
              <Field label="Who sees it"><Select value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}>{["ALL", "NEW_USERS", "VERIFIED", "PACKAGE", "LIFECYCLE_STAGE"].map((v) => <option key={v} value={v}>{v.replace(/_/g, " ").toLowerCase()}</option>)}</Select></Field>
              <Field label="Starts"><Input type="datetime-local" value={f.startAt} onChange={(e) => setF({ ...f, startAt: e.target.value })} /></Field>
              <Field label="Ends"><Input type="datetime-local" value={f.endAt} onChange={(e) => setF({ ...f, endAt: e.target.value })} /></Field>
            </div>
            {["PACKAGE", "LIFECYCLE_STAGE"].includes(f.audience) && <Field label={f.audience === "PACKAGE" ? "Package code" : "Lifecycle stage"}><Input value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></Field>}
            <Button onClick={create} disabled={f.title.trim().length < 3 || f.body.trim().length < 10}>Save as draft</Button>
          </div>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Feedback & surveys
interface FbRow { id: string; code: string; profileId: string; type: string; subject: string | null; message: string; rating: number | null; choice: string | null; status: string; createdAt: string }
interface SurveyRow { id: string; code: string; title: string; kind: string; status: string; responses: number }
function FeedbackTab({ can }: { can: Can }) {
  const { show } = useToast();
  const fb = useApi<{ items: FbRow[] }>("/api/admin/engagement/feedback");
  const sv = useApi<{ items: SurveyRow[] }>("/api/admin/engagement/surveys");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("PLATFORM_USABILITY");
  const [q, setQ] = useState('[{ "id": "q1", "text": "How easy was it to complete your profile?", "type": "RATING" }]');
  const [results, setResults] = useState<unknown>(null);
  async function createSurvey() {
    let questions: unknown;
    try {
      questions = JSON.parse(q);
    } catch {
      return show("The questions are not valid JSON.", "error");
    }
    if (await act(show, "/api/admin/engagement/surveys", "POST", { title, kind, questions }, "Survey saved as a draft.")) {
      setTitle("");
      sv.reload();
    }
  }
  return (
    <div className="space-y-4">
      <Card title="Feedback">
        {fb.loading ? <Loading /> : fb.error || !fb.data ? <ErrorNote message={fb.error ?? "Could not load."} /> : fb.data.items.length === 0 ? <EmptyState title="No feedback yet" /> : (
          <ul className="divide-y divide-border text-sm">
            {fb.data.items.map((r) => (
              <li key={r.id} className="space-y-1 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{r.subject || r.type.replace(/_/g, " ").toLowerCase()} <span className="text-xs text-muted">{r.code}{r.rating ? ` · ${r.rating}/5` : ""}{r.choice ? ` · ${r.choice.toLowerCase().replace(/_/g, " ")}` : ""}</span></span>
                  <StatusBadge status={r.status} />
                </div>
                <p className="whitespace-pre-line text-muted">{r.message}</p>
                {can("engagement:feedback:manage") && (
                  <div className="flex gap-2">
                    {["IN_REVIEW", "RESOLVED", "ARCHIVED"].filter((s) => s !== r.status).map((s) => <Button key={s} size="sm" variant="outline" onClick={async () => { if (await act(show, `/api/admin/engagement/feedback/${r.id}`, "PATCH", { status: s }, "Updated.")) fb.reload(); }}>{s.replace(/_/g, " ").toLowerCase()}</Button>)}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Surveys">
        {sv.loading ? <Loading /> : sv.error || !sv.data ? <ErrorNote message={sv.error ?? "Could not load."} /> : sv.data.items.length === 0 ? <EmptyState title="No surveys" /> : (
          <ul className="divide-y divide-border text-sm">
            {sv.data.items.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{s.title} <span className="text-xs text-muted">{s.code} · {s.responses} responses</span></span>
                <div className="flex items-center gap-2"><StatusBadge status={s.status} />
                  {can("engagement:feedback:manage") && s.status !== "PUBLISHED" && <Button size="sm" variant="outline" onClick={async () => { if (await act(show, `/api/admin/engagement/surveys/${s.id}`, "POST", { status: "PUBLISHED" }, "Published.")) sv.reload(); }}>Publish</Button>}
                  <Button size="sm" variant="outline" onClick={async () => setResults(await (await fetch(`/api/admin/engagement/surveys/${s.id}`)).json())}>Results</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {results !== null && <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-background p-3 text-xs">{JSON.stringify(results, null, 2)}</pre>}
      </Card>
      {can("engagement:feedback:manage") && (
        <Card title="New survey">
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} /></Field>
              <Field label="Kind"><Select value={kind} onChange={(e) => setKind(e.target.value)}>{["SUPPORT_SATISFACTION", "ONBOARDING_SATISFACTION", "PLATFORM_USABILITY"].map((k) => <option key={k} value={k}>{k.replace(/_/g, " ").toLowerCase()}</option>)}</Select></Field>
            </div>
            <Field label="Questions (JSON)" hint="Questions cannot ask about marriage or match outcomes."><Textarea value={q} onChange={(e) => setQ(e.target.value)} rows={5} className="font-mono text-xs" /></Field>
            <Button onClick={createSurvey} disabled={title.trim().length < 3}>Save as draft</Button>
          </div>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Analytics
function AnalyticsTab({ can }: { can: Can }) {
  const [kind, setKind] = useState("funnel");
  const { data, error, loading } = useApi<Record<string, unknown>>(`/api/admin/engagement/analytics?kind=${kind}&days=90`);
  return (
    <Card title="Analytics" action={<div className="flex items-center gap-2"><Select value={kind} onChange={(e) => setKind(e.target.value)} className="w-44">{[["funnel", "Funnel"], ["retention", "Retention (D1/D7/D30)"], ["cohorts", "Cohorts"], ["channels", "Channel health"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>{can("engagement:analytics:export") && <a className="text-sm text-primary hover:underline" href="/api/admin/engagement/analytics/export?days=90">Download daily counts (CSV)</a>}</div>}>
      {loading ? <Loading /> : error || !data ? <ErrorNote message={error ?? "Could not load."} /> : <AnalyticsView kind={kind} data={data} />}
    </Card>
  );
}

function AnalyticsView({ kind, data }: { kind: string; data: Record<string, unknown> }) {
  if (kind === "funnel") {
    const d = data as { steps: Array<{ key: string; label: string; people: number; rateFromPrevious: number | null; capped: boolean }>; definition: string };
    return (
      <div className="space-y-2 text-sm">
        <ul className="divide-y divide-border">{d.steps.map((s) => <li key={s.key} className="flex justify-between py-2"><span>{s.label}</span><span>{s.people}{s.capped ? "+" : ""} <span className="text-xs text-muted">{s.rateFromPrevious === null ? "" : `(${s.rateFromPrevious}% of previous step)`}</span></span></li>)}</ul>
        <p className="text-xs text-muted">{d.definition} A percentage is shown only when there are at least 5 people in the previous step.</p>
      </div>
    );
  }
  if (kind === "retention") {
    const d = data as { retention: Array<{ day: number; cohortSize: number; returned: number; rate: number | null }>; definition: string };
    return (
      <div className="space-y-2 text-sm">
        <ul className="divide-y divide-border">{d.retention.map((r) => <li key={r.day} className="flex justify-between py-2"><span>Day {r.day}</span><span>{r.rate === null ? "Not enough data" : `${r.rate}%`} <span className="text-xs text-muted">({r.returned} of {r.cohortSize})</span></span></li>)}</ul>
        <p className="text-xs text-muted">{d.definition}</p>
      </div>
    );
  }
  return <pre className="max-h-96 overflow-auto rounded-lg bg-background p-3 text-xs">{JSON.stringify(data, null, 2)}</pre>;
}

// ---------------------------------------------------------------- Settings
interface Settings { [k: string]: unknown; maxDailyNotifications: number; maxWeeklyReengagement: number; maxFollowupAttempts: number; maxReengagementAttempts: number; lowActivityAfterDays: number; inactiveAfterDays: number; reengagementCooldownDays: number; reminderMinGapHours: number; quietHoursStart: number; quietHoursEnd: number; defaultTimezone: string }
const LABELS: Array<[keyof Settings, string]> = [
  ["maxDailyNotifications", "Most engagement messages per person per day"], ["maxWeeklyReengagement", "Most re-engagement messages per person per week"],
  ["maxFollowupAttempts", "Most follow-up reminders for one item"], ["maxReengagementAttempts", "Most re-engagement attempts per person"],
  ["lowActivityAfterDays", "Low activity after (days)"], ["inactiveAfterDays", "Inactive after (days)"], ["reengagementCooldownDays", "Wait between re-engagement attempts (days)"],
  ["reminderMinGapHours", "Minimum gap between reminders of the same kind (hours)"], ["quietHoursStart", "Default quiet hours start (0-23)"], ["quietHoursEnd", "Default quiet hours end (0-23)"],
];
function SettingsTab({ can }: { can: Can }) {
  const { show } = useToast();
  const { data, error, loading, reload } = useApi<Settings>("/api/admin/engagement/settings");
  const [edit, setEdit] = useState<Partial<Settings>>({});
  const [reason, setReason] = useState("");
  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? "Could not load."} />;
  const editable = can("engagement:manage");
  return (
    <Card title="Limits and thresholds">
      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          {LABELS.map(([k, label]) => (
            <Field key={k as string} label={label}><Input type="number" disabled={!editable} value={String(edit[k] ?? data[k])} onChange={(e) => setEdit({ ...edit, [k]: Number(e.target.value) })} /></Field>
          ))}
          <Field label="Default time zone"><Input disabled={!editable} value={String(edit.defaultTimezone ?? data.defaultTimezone)} onChange={(e) => setEdit({ ...edit, defaultTimezone: e.target.value })} /></Field>
        </div>
        {editable && (
          <>
            <Field label="Reason for the change"><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field>
            <Button disabled={!Object.keys(edit).length || reason.trim().length < 3} onClick={async () => { if (await act(show, "/api/admin/engagement/settings", "PATCH", { ...edit, reason }, "Settings saved.")) { setEdit({}); setReason(""); reload(); } }}>Save</Button>
          </>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- Audit
function AuditTab() {
  const { data, error, loading } = useApi<{ items: Array<{ id: string; action: string; adminId: string | null; targetProfileId: string | null; createdAt: string }> }>("/api/admin/engagement/audit");
  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? "Could not load."} />;
  return (
    <Card title="Engagement audit log">
      {data.items.length === 0 ? <EmptyState title="Nothing recorded yet" /> : (
        <ul className="divide-y divide-border text-sm">{data.items.map((a) => <li key={a.id} className="flex justify-between gap-2 py-2"><span>{a.action.replace(/^ENGAGEMENT_/, "").replace(/_/g, " ").toLowerCase()}</span><span className="text-xs text-muted">{timeAgo(a.createdAt)}</span></li>)}</ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- Assistant
interface AiResult { ok: boolean; result?: { summary: string; data?: { suggestions?: string[]; reviewLabel?: string }; limitations: string[] }; message?: string }
function AssistantTab() {
  const { show } = useToast();
  const [mode, setMode] = useState("REMINDER_DRAFT");
  const [language, setLanguage] = useState<"EN" | "UR">("EN");
  const [kind, setKind] = useState("PROFILE_INCOMPLETE");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<AiResult | null>(null);
  async function run() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/engagement/ai/assist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, language, reminderKind: mode === "REMINDER_DRAFT" ? kind : undefined }) });
      const data = (await res.json().catch(() => ({}))) as AiResult;
      if (!res.ok || !data.ok) show(data.message ?? "The assistant is not available.", "error");
      setOut(res.ok ? data : null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title="Engagement assistant (drafts and summaries only)">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="What do you need?"><Select value={mode} onChange={(e) => setMode(e.target.value)} className="w-72">{[["REMINDER_DRAFT", "Reminder wording"], ["CONTENT_SUGGESTION", "Guide article topics"], ["FEEDBACK_SUMMARY", "Feedback summary (counts)"], ["ANALYTICS_SUMMARY", "Analytics summary"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        {mode === "REMINDER_DRAFT" && <Field label="Reminder"><Select value={kind} onChange={(e) => setKind(e.target.value)} className="w-56">{["PROFILE_INCOMPLETE", "VERIFICATION_STALLED", "PROPOSAL_PENDING", "MEETING_UNCONFIRMED", "INACTIVITY", "MEMBERSHIP_EXPIRING"].map((k) => <option key={k} value={k}>{k.replace(/_/g, " ").toLowerCase()}</option>)}</Select></Field>}
        <Field label="Language"><Select value={language} onChange={(e) => setLanguage(e.target.value as "EN" | "UR")} className="w-28"><option value="EN">English</option><option value="UR">Urdu</option></Select></Field>
        <Button onClick={run} disabled={busy}>{busy ? "Working…" : "Go"}</Button>
      </div>
      <p className="mt-2 text-xs text-muted">For one applicant&apos;s journey summary, use the Engagement tab on their CRM record.</p>
      {out?.result && (
        <div className="mt-3 space-y-2 text-sm">
          <p className="font-medium">{out.result.data?.reviewLabel}</p>
          <p className="text-muted">{out.result.summary}</p>
          <ul className="space-y-2" dir={language === "UR" ? "rtl" : "ltr"}>{(out.result.data?.suggestions ?? []).map((s, i) => <li key={i} className="whitespace-pre-line rounded-lg border border-border bg-background p-3">{s}</li>)}</ul>
          <ul className="list-disc ps-5 text-xs text-muted">{out.result.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </div>
      )}
    </Card>
  );
}
