"use client";

import { useState } from "react";
import Link from "next/link";
import { AlarmClock, Copy, Flag, Gauge, ShieldAlert, ShieldQuestion, Siren } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Tabs } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { StatCard } from "@/components/admin/stat-card";
import { Card, ErrorNote, KV, Loading, SensitiveActionDialog, StatusBadge, callApi, timeAgo, useApi } from "@/components/admin/system/shared";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatDateTime, formatEnumLabel } from "@/lib/utils";
import { HumanReviewNotice, LevelBadge } from "@/components/admin/risk/risk-shared";

interface Overview {
  openCases: number; overdueCases: number; openSignals: number; unresolvedDuplicateClusters: number; activeTechnicalControls: number;
  reportsLast7Days: number; falsePositiveRate: number | null; averageOpenAgeHours: number | null; reviewedLast30Days: number;
  openCasesByLevel: Record<string, number>; signalsByCategory: Record<string, number>;
}

export function RiskCenterClient({ permissions }: { permissions: string[] }) {
  const can = (p: string) => permissions.includes(p);
  const overview = useApi<Overview>("/api/admin/risk/overview");
  const tabs = [
    { value: "cases", label: "Cases", show: can("risk:view") },
    { value: "signals", label: "Signals", show: can("risk:view") },
    { value: "reports", label: "User reports", show: can("user-reports:view") },
    { value: "events", label: "Security events", show: can("security:events:view") },
    { value: "controls", label: "Technical controls", show: can("security:incidents:manage") },
    { value: "report", label: "Risk report", show: can("risk:reports:view") },
  ].filter((t) => t.show);
  const [tab, setTab] = useState(tabs[0]?.value ?? "cases");
  const o = overview.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Risk &amp; Safety Center</h1>
          <p className="text-sm text-muted">Signals, review cases and safety intelligence. Everything here asks for a human decision.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can("duplicates:view") && <Link href="/admin/risk-center/duplicates" className="text-sm text-primary hover:underline">Duplicate clusters</Link>}
          {(can("risk:rules:view") || can("risk:configuration:view")) && <Link href="/admin/risk-center/rules" className="text-sm text-primary hover:underline">Rules &amp; thresholds</Link>}
        </div>
      </div>
      <HumanReviewNotice />

      {overview.error && <ErrorNote message={overview.error} />}
      {o && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard icon={ShieldAlert} label="Open cases" value={o.openCases} accent={o.openCasesByLevel.CRITICAL + o.openCasesByLevel.HIGH > 0 ? "danger" : "primary"} />
          <StatCard icon={AlarmClock} label="Overdue reviews" value={o.overdueCases} accent={o.overdueCases > 0 ? "warning" : "success"} />
          <StatCard icon={Flag} label="Open signals" value={o.openSignals} accent="info" />
          <StatCard icon={Copy} label="Unresolved duplicate clusters" value={o.unresolvedDuplicateClusters} accent={o.unresolvedDuplicateClusters > 0 ? "warning" : "success"} />
          <StatCard icon={Siren} label="Active technical controls" value={o.activeTechnicalControls} accent={o.activeTechnicalControls > 0 ? "warning" : "muted"} />
          <StatCard icon={ShieldQuestion} label="Reports (7 days)" value={o.reportsLast7Days} />
          <StatCard icon={Gauge} label="False-positive rate (30 d)" value={o.falsePositiveRate === null ? "—" : `${Math.round(o.falsePositiveRate * 100)}%`} accent="muted" />
          <StatCard icon={AlarmClock} label="Avg. open case age" value={o.averageOpenAgeHours === null ? "—" : `${o.averageOpenAgeHours} h`} accent="muted" />
        </div>
      )}

      <Tabs tabs={tabs.map(({ value, label }) => ({ value, label }))} value={tab} onChange={setTab} />
      {tab === "cases" && <CasesTab />}
      {tab === "signals" && <SignalsTab canResolve={can("risk:resolve")} />}
      {tab === "reports" && <ReportsTab canManage={can("user-reports:manage")} />}
      {tab === "events" && <EventsTab />}
      {tab === "controls" && <ControlsTab />}
      {tab === "report" && <ReportTab canExport={can("risk:reports:export")} />}
    </div>
  );
}

// ------------------------------------------------------------------ Cases
interface CaseRow { id: string; riskCode: string; status: string; riskLevel: string; category: string; title: string; subject: { kind: string; profileCode?: string | null }; overdue: boolean; createdAt: string }

function CasesTab() {
  const [status, setStatus] = useState("ACTIVE");
  const [level, setLevel] = useState("");
  const qs = new URLSearchParams({ status, ...(level ? { level } : {}) }).toString();
  const { data, error, loading } = useApi<{ items: CaseRow[] }>(`/api/admin/risk/cases?${qs}`);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-48"><option value="ACTIVE">Active cases</option><option value="">All cases</option><option value="CLOSED">Closed</option><option value="CLEARED">Cleared</option><option value="FALSE_POSITIVE">False positives</option></Select>
        <Select value={level} onChange={(e) => setLevel(e.target.value)} className="w-40"><option value="">Any level</option><option value="CRITICAL">Critical</option><option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option></Select>
      </div>
      {loading && !data && <Loading />}
      {error && <ErrorNote message={error} />}
      {data && data.items.length === 0 && <EmptyState title="No cases" description="Nothing matches this filter." />}
      {data && data.items.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {data.items.map((c) => (
            <li key={c.id}>
              <Link href={`/admin/risk-center/${c.id}`} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm hover:bg-surface-muted">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs">{c.riskCode}</span>
                  <LevelBadge level={c.riskLevel} />
                  <StatusBadge status={c.status} />
                  <span className="text-muted">{formatEnumLabel(c.category)}</span>
                  <span>{c.subject.kind === "STAFF" ? "Staff account" : (c.subject.profileCode ?? "Applicant")}</span>
                  {c.overdue && <Badge variant="danger">Overdue</Badge>}
                </span>
                <span className="text-xs text-muted">{timeAgo(c.createdAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Signals
interface SignalRow { id: string; flagType: string; severity: string; status: string; description: string; createdAt: string; signalCode: string | null; confidence: string | null; profile: { id: string; profileCode: string } }

function SignalsTab({ canResolve }: { canResolve: boolean }) {
  const { data, error, loading, reload } = useApi<{ items: SignalRow[] }>("/api/admin/risk/signals?status=OPEN");
  const { show } = useToast();
  const [target, setTarget] = useState<SignalRow | null>(null);
  const [note, setNote] = useState("");
  const [reasonKey, setReasonKey] = useState("");

  async function patch(id: string, body: Record<string, unknown>) {
    const r = await callApi(`/api/admin/risk/signals/${id}`, "PATCH", body);
    if (!r.ok) show(r.data.error ?? "Could not update the signal", "error");
    else { show("Signal updated", "success"); setTarget(null); setNote(""); setReasonKey(""); reload(); }
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">A signal is an unverified indicator. Many have innocent explanations. Duplicate signals are handled in the duplicates workspace.</p>
      {loading && !data && <Loading />}
      {error && <ErrorNote message={error} />}
      {data && data.items.length === 0 && <EmptyState title="No open signals" />}
      {data && data.items.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {data.items.map((s) => (
            <li key={s.id} className="space-y-1 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{formatEnumLabel(s.flagType)}</span>
                <StatusBadge status={s.status} />
                <Badge variant="muted">{s.severity.toLowerCase()} severity</Badge>
                {s.confidence && <Badge variant="muted">{formatEnumLabel(s.confidence)} confidence</Badge>}
                <span className="text-xs text-muted">{s.profile.profileCode}</span>
                {s.signalCode && <span className="font-mono text-xs text-muted">{s.signalCode}</span>}
              </div>
              <p className="text-xs text-muted">{s.description}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => patch(s.id, { status: "ACKNOWLEDGED" })}>Acknowledge</Button>
                {canResolve && <Button size="sm" variant="outline" onClick={() => setTarget(s)}>Resolve / false positive…</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog open={!!target} title="Resolve signal" description="Resolving keeps the signal and its history. For a false positive, say why so the same pattern is not flagged again." confirmLabel="Save" confirmDisabled={note.trim().length < 5} onCancel={() => setTarget(null)}
        onConfirm={() => target && patch(target.id, reasonKey ? { status: "FALSE_POSITIVE", resolution: note, falsePositiveReason: reasonKey } : { status: "RESOLVED", resolution: note })}>
        <Field label="Outcome"><Select value={reasonKey} onChange={(e) => setReasonKey(e.target.value)}><option value="">Resolved — reviewed</option><option value="SHARED_FAMILY_DEVICE">False positive — shared family device</option><option value="SHARED_FAMILY_PHONE">False positive — shared family phone</option><option value="SHARED_HOME_NETWORK">False positive — shared home network</option><option value="DATA_ENTRY_ERROR">False positive — data-entry mistake</option><option value="PROVIDER_ERROR">False positive — provider error</option><option value="INCORRECT_SIGNAL">False positive — signal was incorrect</option><option value="OTHER">False positive — other</option></Select></Field>
        <Field label="Note"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </ConfirmDialog>
    </div>
  );
}

// ------------------------------------------------------------------ User reports
interface ReportRow { id: string; reportCode: string; reportType: string; status: string; reporter: string | null; reported: string | null; description?: string; riskCaseId: string | null; createdAt: string }

function ReportsTab({ canManage }: { canManage: boolean }) {
  const { data, error, loading, reload } = useApi<{ items: ReportRow[] }>("/api/admin/user-reports");
  const { show } = useToast();
  const [target, setTarget] = useState<{ row: ReportRow; status: string } | null>(null);
  const [note, setNote] = useState("");
  async function move(row: ReportRow, status: string, resolutionNote?: string) {
    const r = await callApi(`/api/admin/user-reports/${row.id}`, "PATCH", { status, resolutionNote });
    if (!r.ok) show(r.data.error ?? "Could not update the report", "error");
    else { show("Report updated", "success"); setTarget(null); setNote(""); reload(); }
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">Reports are allegations by other members. They have not been verified and are never shown to the reported person.</p>
      {loading && !data && <Loading />}
      {error && <ErrorNote message={error} />}
      {data && data.items.length === 0 && <EmptyState title="No reports" />}
      {data && data.items.map((r) => (
        <div key={r.id} className="space-y-1 rounded-xl border border-border bg-surface p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs">{r.reportCode}</span><StatusBadge status={r.status} /><span>{formatEnumLabel(r.reportType)}</span><span className="text-xs text-muted">from {r.reporter ?? "—"} about {r.reported ?? "no specific profile"}</span></div>
          {r.description && <p className="text-xs text-muted">{r.description}</p>}
          {canManage && r.status !== "CLOSED" && (
            <div className="flex flex-wrap gap-2">
              {r.status === "RECEIVED" && <Button size="sm" variant="outline" onClick={() => move(r, "UNDER_REVIEW")}>Start review</Button>}
              {r.status !== "ACTION_TAKEN" && r.status !== "NO_ACTION_NEEDED" && <Button size="sm" variant="outline" onClick={() => setTarget({ row: r, status: "NO_ACTION_NEEDED" })}>No action needed…</Button>}
              {r.status === "UNDER_REVIEW" && <Button size="sm" variant="outline" onClick={() => setTarget({ row: r, status: "ACTION_TAKEN" })}>Action taken…</Button>}
              <Button size="sm" variant="ghost" onClick={() => setTarget({ row: r, status: "CLOSED" })}>Close…</Button>
              {r.riskCaseId && <Link href={`/admin/risk-center/${r.riskCaseId}`} className="self-center text-xs text-primary hover:underline">Open risk case</Link>}
            </div>
          )}
        </div>
      ))}
      <ConfirmDialog open={!!target} title="Update report" description="This note is visible to the person who made the report, so keep it neutral and do not mention anyone else." confirmLabel="Save" confirmDisabled={note.trim().length < 3} onCancel={() => setTarget(null)} onConfirm={() => target && move(target.row, target.status, note)}>
        <Field label="Neutral resolution note"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </ConfirmDialog>
    </div>
  );
}

// ------------------------------------------------------------------ Security events
function EventsTab() {
  const [type, setType] = useState("");
  const { data, error, loading } = useApi<{ items: Array<{ id: string; eventType: string; source: string; outcome: string | null; createdAt: string; ipHash?: string | null; userAgentHash?: string | null }> }>(`/api/admin/security/events${type ? `?eventType=${type}` : ""}`);
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">The event ledger stores hashed identifiers only. Network and device hashes need extra permissions and are off by default.</p>
      <Select value={type} onChange={(e) => setType(e.target.value)} className="w-56"><option value="">All event types</option>{["LOGIN_FAILED", "OTP_REQUESTED", "OTP_FAILED", "PERMISSION_DENIED", "ADMIN_SENSITIVE_ACCESS", "PROFILE_UPDATED", "CONTACT_UPDATED", "FAMILY_INVITE_CREATED", "PAYMENT_FAILED", "VERIFICATION_FAILED", "ACCOUNT_CREATED"].map((t) => <option key={t} value={t}>{formatEnumLabel(t)}</option>)}</Select>
      {loading && !data && <Loading />}
      {error && <ErrorNote message={error} />}
      {data && data.items.length === 0 && <EmptyState title="No events" />}
      {data && data.items.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface text-sm">
          {data.items.map((e) => <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 p-2"><span>{formatEnumLabel(e.eventType)} <span className="text-xs text-muted">· {e.source}{e.outcome ? ` · ${e.outcome}` : ""}</span></span><span className="text-xs text-muted">{formatDateTime(e.createdAt)}</span></li>)}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Technical controls
function ControlsTab() {
  const { data, error, loading, reload } = useApi<{ items: Array<{ id: string; controlType: string; subjectType: string; subjectRef: string; reason: string; status: string; expiresAt: string }>; note: string }>("/api/admin/security/incidents");
  const { show } = useToast();
  const [open, setOpen] = useState(false);
  const [controlType, setControlType] = useState("IP_BLOCK");
  const [subjectType, setSubjectType] = useState("IP_HASH");
  const [subjectRef, setSubjectRef] = useState("");
  const [minutes, setMinutes] = useState("60");
  async function lift(id: string) {
    const r = await callApi(`/api/admin/security/incidents/${id}/lift`, "POST", {});
    if (!r.ok) show(r.data.error ?? "Could not lift the control", "error");
    else { show("Control lifted", "success"); reload(); }
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted">Emergency technical measures against an active attack. Always temporary (max 24 h), always audited, and not a decision about any person.</p>
        <Button size="sm" onClick={() => setOpen(true)}>Apply control</Button>
      </div>
      {loading && !data && <Loading />}
      {error && <ErrorNote message={error} />}
      {data && data.items.length === 0 && <EmptyState title="No technical controls" />}
      {data && data.items.map((i) => (
        <Card key={i.id}>
          <dl>
            <KV label="Control">{formatEnumLabel(i.controlType)} · {formatEnumLabel(i.subjectType)}</KV>
            <KV label="Status"><StatusBadge status={i.status} /></KV>
            <KV label="Expires">{formatDateTime(i.expiresAt)}</KV>
            <KV label="Reason">{i.reason}</KV>
          </dl>
          {i.status === "ACTIVE" && <Button size="sm" variant="outline" className="mt-2" onClick={() => lift(i.id)}>Lift now</Button>}
        </Card>
      ))}
      <SensitiveActionDialog
        open={open} danger title="Apply a technical control" confirmLabel="Apply"
        description="This limits an access path for a short time. It does not restrict or suspend any profile."
        onCancel={() => setOpen(false)}
        onConfirm={async ({ reason, stepUpToken }) => {
          const r = await callApi("/api/admin/security/incidents", "POST", { controlType, subjectType, subjectRef, reason, stepUpToken, durationMinutes: Number(minutes) });
          if (!r.ok) return r.data.error ?? "Could not apply the control";
          show("Technical control applied", "success");
          reload();
          return null;
        }}
      >
        <Field label="Control"><Select value={controlType} onChange={(e) => setControlType(e.target.value)}>{["SESSION_REVOCATION", "SUBJECT_THROTTLE", "IP_BLOCK", "OTP_THROTTLE", "LOGIN_PROTECTION"].map((t) => <option key={t} value={t}>{formatEnumLabel(t)}</option>)}</Select></Field>
        <Field label="Applies to"><Select value={subjectType} onChange={(e) => setSubjectType(e.target.value)}>{["PROFILE", "ADMIN", "IP_HASH", "SUBJECT_KEY"].map((t) => <option key={t} value={t}>{formatEnumLabel(t)}</option>)}</Select></Field>
        <Field label="Subject reference" hint="A profile id, admin id or a hash — not a phone or e-mail."><Input value={subjectRef} onChange={(e) => setSubjectRef(e.target.value)} autoComplete="off" /></Field>
        <Field label="Duration (minutes, max 1440)"><Input type="number" min={1} max={1440} value={minutes} onChange={(e) => setMinutes(e.target.value)} /></Field>
      </SensitiveActionDialog>
    </div>
  );
}

// ------------------------------------------------------------------ Report
interface Report {
  period: { from: string; to: string }; casesOpened: number; meanHoursToFirstReview: number | null; technicalControls: number;
  signalsByType: Record<string, number>; casesByStatus: Record<string, number>; casesByLevel: Record<string, number>; decisions: Record<string, number>;
  falsePositives: { total: number; byReason: Record<string, number>; rateOfDecided: number | null };
  restrictions: { applied: number; temporary: number; permanent: number };
  userReports: { total: number };
}

function Dist({ title, map }: { title: string; map: Record<string, number> }) {
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
  return <Card title={title}>{entries.length === 0 ? <p className="text-sm text-muted">No data in this period.</p> : <dl>{entries.map(([k, v]) => <KV key={k} label={formatEnumLabel(k)}>{v}</KV>)}</dl>}</Card>;
}

function ReportTab({ canExport }: { canExport: boolean }) {
  const [days, setDays] = useState("30");
  const [now] = useState(() => Date.now());
  const from = new Date(now - Number(days) * 86_400_000).toISOString();
  const { data, error, loading } = useApi<Report>(`/api/admin/reports/risk?from=${encodeURIComponent(from)}`);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={days} onChange={(e) => setDays(e.target.value)} className="w-40"><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last year</option></Select>
        {canExport && <a className="text-sm text-primary hover:underline" href={`/api/admin/reports/risk?format=csv&from=${encodeURIComponent(from)}`}>Download CSV</a>}
        <span className="text-xs text-muted">Aggregates only — no personal identifiers.</span>
      </div>
      {loading && !data && <Loading />}
      {error && <ErrorNote message={error} />}
      {data && (
        <div className="grid gap-3 md:grid-cols-2">
          <Card title="Summary"><dl>
            <KV label="Cases opened">{data.casesOpened}</KV>
            <KV label="Mean hours to first review">{data.meanHoursToFirstReview ?? "—"}</KV>
            <KV label="False positives">{data.falsePositives.total}{data.falsePositives.rateOfDecided !== null ? ` (${Math.round(data.falsePositives.rateOfDecided * 100)}% of decided)` : ""}</KV>
            <KV label="Restrictions applied">{data.restrictions.applied} ({data.restrictions.temporary} temporary, {data.restrictions.permanent} permanent)</KV>
            <KV label="Technical controls">{data.technicalControls}</KV>
            <KV label="User reports">{data.userReports.total}</KV>
          </dl></Card>
          <Dist title="Signals by type" map={data.signalsByType} />
          <Dist title="Cases by status" map={data.casesByStatus} />
          <Dist title="Cases by level" map={data.casesByLevel} />
          <Dist title="Review decisions" map={data.decisions} />
          <Dist title="False-positive reasons" map={data.falsePositives.byReason} />
        </div>
      )}
    </div>
  );
}
