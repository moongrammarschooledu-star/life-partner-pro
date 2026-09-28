"use client";

import { useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Timeline } from "@/components/ui/timeline";
import { useToast } from "@/components/ui/toast";
import { Card, ErrorNote, KV, Loading, SensitiveActionDialog, StatusBadge, callApi, useApi } from "@/components/admin/system/shared";
import { ResultView, ErrorBox, useAiCall } from "@/components/admin/ai/ai-shared";
import { isActionAllowed, type RiskCaseAction } from "@/lib/risk/case-actions";
import { formatDateTime, formatEnumLabel } from "@/lib/utils";
import { CHECKLIST_ITEMS, FALSE_POSITIVE_CHOICES, HumanReviewNotice, LevelBadge, RESTRICTION_CHOICES } from "@/components/admin/risk/risk-shared";
import type { RiskCaseStatus } from "@prisma/client";

interface CaseDetail {
  case: { id: string; riskCode: string; status: RiskCaseStatus; riskLevel: string; riskState: string; category: string; title: string; openedBy: string; dueAt: string | null; createdAt: string; subjectAdminId: string | null; outcome: string | null };
  subject: { kind: "STAFF" } | { kind: "APPLICANT"; profile: { id: string; profileCode: string; fullName: string; status: string; verified: boolean; city: string; country: string } | null };
  signals: Array<{ id: string; signalCode: string | null; flagType: string; severity: string; confidence: string | null; category: string | null; status: string; description: string; ruleVersion: number | null; falsePositiveReason: string | null; createdAt: string }>;
  assessment: { riskLevel: string; score: number | null; confidence: string; ruleVersion: number; configurationVersion: number; cappedBySingleSignal: boolean; createdAt: string; topSignals: Array<{ type: string; severity: string; confidence: string | null; contribution: number }> | null } | null;
  events: Array<{ id: string; eventType: string; summary: string; createdAt: string }>;
  reviews: Array<{ id: string; decision: string; notes: string | null; createdAt: string; approvalId: string | null }>;
  evidence: Array<{ id: string; evidenceType: string; source: string; summary: string; occurredAt: string; integrityOk: boolean }>;
  restrictions: Array<{ id: string; restrictionType: string; active: boolean; endDate: string | null; isPermanent: boolean; reason: string }>;
  duplicateClusters: Array<{ id: string; status: string; confidenceBand: string; memberCount: number }>;
  userReports: Array<{ reportCode: string; reportType: string; status: string }>;
  tasks: Array<{ id: string; taskCode?: string; taskType: string; status: string }>;
}

type Dialog = null | "request-info" | "escalate" | "clear" | "resolve" | "close" | "restrict" | "suspend" | "note" | "evidence";

export function RiskCaseClient({ caseId, permissions }: { caseId: string; permissions: string[] }) {
  const { data, error, loading, reload } = useApi<CaseDetail>(`/api/admin/risk/cases/${caseId}`);
  const { show } = useToast();
  const ai = useAiCall();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [reason, setReason] = useState("");
  const [kind, setKind] = useState("INFORMATION");
  const [decision, setDecision] = useState("DISMISS");
  const [fpReason, setFpReason] = useState("SHARED_FAMILY_PHONE");
  const [outcome, setOutcome] = useState("");
  const [note, setNote] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [endDate, setEndDate] = useState("");
  const [permanent, setPermanent] = useState(false);
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [evidenceType, setEvidenceType] = useState("ADMIN_NOTE");
  const [evidenceSummary, setEvidenceSummary] = useState("");
  const [now] = useState(() => Date.now());

  const can = (p: string) => permissions.includes(p);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;
  const c = data.case;
  const allowed = (a: RiskCaseAction) => isActionAllowed(c.status, a);
  const isStaffCase = data.subject.kind === "STAFF";

  function close() {
    setDialog(null);
    setReason(""); setNote(""); setOutcome(""); setTypes([]); setEndDate(""); setPermanent(false); setChecklist({}); setEvidenceSummary("");
  }

  async function act(path: string, body: Record<string, unknown>, okMessage: string): Promise<string | null> {
    const r = await callApi<{ approvalRequired?: boolean; approvalCode?: string }>(`/api/admin/risk/cases/${caseId}/${path}`, "POST", body);
    if (!r.ok) return r.data.error ?? "The action could not be completed.";
    if (r.data.approvalRequired) show(`Approval requested (${r.data.approvalCode}). Nothing has been applied yet.`, "info");
    else show(okMessage, "success");
    close();
    reload();
    return null;
  }

  const checklistDone = CHECKLIST_ITEMS.every((i) => checklist[i.key]);
  const checklistUi = (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <p className="text-xs font-medium">Required review checklist</p>
      {CHECKLIST_ITEMS.map((i) => (
        <Checkbox key={i.key} label={i.label} checked={!!checklist[i.key]} onChange={(e) => setChecklist({ ...checklist, [i.key]: e.target.checked })} />
      ))}
    </div>
  );

  const plainAction = (path: string, done: string, body: Record<string, unknown> = {}) => async () => {
    const message = await act(path, body, done);
    if (message) show(message, "error");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/admin/risk-center" className="text-sm text-primary hover:underline">← Risk &amp; Safety Center</Link>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{c.riskCode}</h1>
        <StatusBadge status={c.status} />
        <LevelBadge level={c.riskLevel} />
        <Badge variant="muted">{formatEnumLabel(c.category)}</Badge>
        {c.dueAt && new Date(c.dueAt).getTime() < now && !["CLEARED", "DISMISSED", "FALSE_POSITIVE", "CLOSED"].includes(c.status) && <Badge variant="danger">Review overdue</Badge>}
      </div>
      <HumanReviewNotice />

      <Card title="Actions">
        <div className="flex flex-wrap gap-2">
          {allowed("ACKNOWLEDGE") && can("risk:review") && <Button size="sm" variant="outline" onClick={plainAction("acknowledge", "Case acknowledged")}>Acknowledge</Button>}
          {allowed("INVESTIGATE") && can("risk:investigate") && <Button size="sm" variant="outline" onClick={plainAction("investigate", "Investigation started")}>Start investigation</Button>}
          {!isStaffCase && allowed("REQUEST_INFORMATION") && can("risk:review") && <Button size="sm" variant="outline" onClick={() => setDialog("request-info")}>Request information / re-verification</Button>}
          {allowed("ESCALATE") && can("risk:escalate") && <Button size="sm" variant="outline" onClick={() => setDialog("escalate")}>Escalate</Button>}
          {(allowed("DISMISS") || allowed("MARK_FALSE_POSITIVE")) && can("risk:resolve") && <Button size="sm" variant="outline" onClick={() => setDialog("resolve")}>Dismiss / false positive</Button>}
          {allowed("CLEAR") && can("risk:clear") && <Button size="sm" variant="outline" onClick={() => setDialog("clear")}>Clear</Button>}
          {!isStaffCase && allowed("RESTRICT") && can("risk:restrict") && <Button size="sm" variant="outline" onClick={() => setDialog("restrict")}>Restrict (approval needed)</Button>}
          {!isStaffCase && allowed("SUSPEND") && can("risk:suspend") && <Button size="sm" variant="danger" onClick={() => setDialog("suspend")}>Suspend (approval needed)</Button>}
          {allowed("CLOSE") && can("risk:resolve") && <Button size="sm" variant="outline" onClick={() => setDialog("close")}>Close case</Button>}
          {can("risk:review") && <Button size="sm" variant="ghost" onClick={() => setDialog("note")}>Add note</Button>}
          {can("risk:evidence:manage") && ["OPEN", "ACKNOWLEDGED", "UNDER_INVESTIGATION", "INFORMATION_REQUESTED", "ESCALATED", "RESTRICTED", "SUSPENDED"].includes(c.status) && <Button size="sm" variant="ghost" onClick={() => setDialog("evidence")}>Add evidence</Button>}
          {can("ai:risk:use") && (
            <Button size="sm" variant="ghost" disabled={ai.loading} onClick={() => ai.run("/api/admin/ai/risk-summary", { riskCaseId: caseId })}>
              <Sparkles className="h-4 w-4" /> {ai.loading ? "Summarising…" : "AI-assisted summary"}
            </Button>
          )}
        </div>
        <p className="mt-2 text-xs text-muted">No action here is automatic. Restricting or suspending needs the review checklist, your password, a reason and a second approver.</p>
      </Card>

      {ai.error && <ErrorBox message={ai.error} />}
      {ai.response && <Card title="AI-Assisted Analysis — Human Review Required"><ResultView response={ai.response} /></Card>}

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Subject">
          {data.subject.kind === "STAFF" ? (
            <p className="text-sm text-muted">Privileged-access review of a staff account. The staff member cannot see or act on this case.</p>
          ) : data.subject.profile ? (
            <dl>
              <KV label="Profile"><Link className="text-primary hover:underline" href={`/admin/profiles/${data.subject.profile.id}`}>{data.subject.profile.profileCode}</Link></KV>
              <KV label="Name">{data.subject.profile.fullName}</KV>
              <KV label="Status"><StatusBadge status={data.subject.profile.status} /></KV>
              <KV label="Verified">{data.subject.profile.verified ? "Yes" : "No"}</KV>
              <KV label="Location">{data.subject.profile.city}, {data.subject.profile.country}</KV>
              <KV label="Relationships"><Link className="text-primary hover:underline" href={`/admin/risk-center/relationships/${data.subject.profile.id}`}>View graph</Link></KV>
            </dl>
          ) : <p className="text-sm text-muted">Profile no longer available.</p>}
          <dl className="mt-2 border-t border-border pt-2">
            <KV label="Opened by">{c.openedBy}</KV>
            <KV label="Opened">{formatDateTime(c.createdAt)}</KV>
            <KV label="Review due">{c.dueAt ? formatDateTime(c.dueAt) : "—"}</KV>
            {c.outcome && <KV label="Outcome">{c.outcome}</KV>}
          </dl>
        </Card>

        <Card title="How this level was derived">
          {data.assessment ? (
            <div className="space-y-2 text-sm">
              <dl>
                <KV label="Indicator level"><LevelBadge level={data.assessment.riskLevel} /></KV>
                <KV label="Internal score">{data.assessment.score ?? "scoring off"}</KV>
                <KV label="Confidence">{formatEnumLabel(data.assessment.confidence)}</KV>
                <KV label="Rule / configuration version">{data.assessment.ruleVersion} / {data.assessment.configurationVersion}</KV>
              </dl>
              {data.assessment.cappedBySingleSignal && <p className="rounded bg-warning/10 p-2 text-xs">The level was limited because it rests on a single low-confidence signal (or on device/network context only).</p>}
              <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
                {(data.assessment.topSignals ?? []).map((s, i) => <li key={i}>{formatEnumLabel(s.type)} — {s.severity.toLowerCase()} severity, contribution {s.contribution}</li>)}
              </ul>
              <p className="text-xs text-muted">The score is internal and is never shown to the applicant.</p>
            </div>
          ) : <p className="text-sm text-muted">No persisted assessment is linked to this case yet.</p>}
        </Card>
      </div>

      <Card title={`Signals (${data.signals.length})`}>
        {data.signals.length === 0 ? <p className="text-sm text-muted">No signals linked.</p> : (
          <ul className="divide-y divide-border">
            {data.signals.map((s) => (
              <li key={s.id} className="py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{formatEnumLabel(s.flagType)}</span>
                  <StatusBadge status={s.status} />
                  <Badge variant="muted">{s.severity.toLowerCase()} severity</Badge>
                  {s.confidence && <Badge variant="muted">{formatEnumLabel(s.confidence)} confidence</Badge>}
                  {s.signalCode && <span className="font-mono text-xs text-muted">{s.signalCode}</span>}
                </div>
                <p className="text-xs text-muted">{s.description}</p>
                {s.falsePositiveReason && <p className="text-xs text-muted">Marked false positive: {formatEnumLabel(s.falsePositiveReason)}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title={`Evidence (${data.evidence.length})`}>
          {data.evidence.length === 0 ? <p className="text-sm text-muted">No evidence attached.</p> : (
            <ul className="space-y-2 text-sm">
              {data.evidence.map((e) => (
                <li key={e.id}>
                  <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{formatEnumLabel(e.evidenceType)}</span><span className="text-xs text-muted">{e.source} · {formatDateTime(e.occurredAt)}</span>{!e.integrityOk && <Badge variant="danger">Integrity check failed</Badge>}</div>
                  <p className="text-xs text-muted">{e.summary}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Restrictions on this profile">
          {data.restrictions.length === 0 ? <p className="text-sm text-muted">None.</p> : (
            <ul className="space-y-1 text-sm">
              {data.restrictions.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{formatEnumLabel(r.restrictionType)}</span>
                  <span className="text-xs text-muted">{r.active ? (r.isPermanent ? "permanent" : r.endDate ? `until ${formatDateTime(r.endDate)}` : "open-ended") : "lifted"}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {(data.duplicateClusters.length > 0 || data.userReports.length > 0 || data.tasks.length > 0) && (
        <Card title="Related records">
          <ul className="space-y-1 text-sm">
            {data.duplicateClusters.map((d) => <li key={d.id}><Link className="text-primary hover:underline" href="/admin/risk-center/duplicates">Duplicate cluster</Link> — {formatEnumLabel(d.confidenceBand)} · {d.memberCount} accounts · {formatEnumLabel(d.status)}</li>)}
            {data.userReports.map((r) => <li key={r.reportCode}>Report {r.reportCode} — {formatEnumLabel(r.reportType)} ({formatEnumLabel(r.status)}), an allegation not yet verified</li>)}
            {data.tasks.map((t) => <li key={t.id}>Task {t.taskCode ?? t.id.slice(0, 8)} — {formatEnumLabel(t.taskType)} ({formatEnumLabel(t.status)})</li>)}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Timeline">
          <Timeline items={data.events.map((e, i) => ({ id: e.id, label: formatEnumLabel(e.eventType), description: e.summary, date: e.createdAt, active: i === data.events.length - 1 }))} />
        </Card>
        <Card title={`Review history (${data.reviews.length})`}>
          {data.reviews.length === 0 ? <p className="text-sm text-muted">No review actions yet.</p> : (
            <ul className="space-y-2 text-sm">
              {data.reviews.map((r) => <li key={r.id}><span className="font-medium">{formatEnumLabel(r.decision)}</span> <span className="text-xs text-muted">{formatDateTime(r.createdAt)}{r.approvalId ? " · approved" : ""}</span>{r.notes && <p className="text-xs text-muted">{r.notes}</p>}</li>)}
            </ul>
          )}
        </Card>
      </div>

      {/* --- dialogs --- */}
      <ConfirmDialog
        open={dialog === "request-info"} title="Request information" description="The applicant receives a neutral notice asking for additional information. Nothing about detection logic or a risk level is revealed."
        confirmLabel="Send request" confirmDisabled={kind === "REVERIFICATION" && reason.trim().length < 5} onCancel={close}
        onConfirm={async () => { const m = await act("request-info", { kind, reason }, "Request sent"); if (m) show(m, "error"); }}
      >
        <Field label="Type"><Select value={kind} onChange={(e) => setKind(e.target.value)}><option value="INFORMATION">Ask for additional information</option><option value="REVERIFICATION">Require re-verification</option></Select></Field>
        <Field label="Reason (required for re-verification)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </ConfirmDialog>

      <ConfirmDialog open={dialog === "escalate"} title="Escalate for senior review" description="Senior reviewers are notified. The account is not affected." confirmLabel="Escalate" confirmDisabled={reason.trim().length < 5} onCancel={close}
        onConfirm={async () => { const m = await act("escalate", { reason }, "Case escalated"); if (m) show(m, "error"); }}>
        <Field label="Reason"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </ConfirmDialog>

      <ConfirmDialog open={dialog === "clear"} title="Clear this case" description="Clears the case, resolves its signals and lifts any restriction this case applied. History is kept." confirmLabel="Clear case" confirmDisabled={reason.trim().length < 5} onCancel={close}
        onConfirm={async () => { const m = await act("clear", { reason }, "Case cleared"); if (m) show(m, "error"); }}>
        <Field label="Reason (recorded)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </ConfirmDialog>

      <ConfirmDialog open={dialog === "resolve"} title="Dismiss or mark as false positive" description="The case and its history are kept. A false positive needs a structured reason so the same pair is not flagged again." confirmLabel="Save decision" confirmDisabled={reason.trim().length < 5} onCancel={close}
        onConfirm={async () => { const m = await act("resolve", { decision, reason, ...(decision === "MARK_FALSE_POSITIVE" ? { falsePositiveReason: fpReason } : {}) }, "Decision recorded"); if (m) show(m, "error"); }}>
        <Field label="Decision"><Select value={decision} onChange={(e) => setDecision(e.target.value)}><option value="DISMISS">Dismiss (no concern found)</option><option value="MARK_FALSE_POSITIVE">Mark as false positive</option></Select></Field>
        {decision === "MARK_FALSE_POSITIVE" && <Field label="Why was it a false positive?"><Select value={fpReason} onChange={(e) => setFpReason(e.target.value)}>{FALSE_POSITIVE_CHOICES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></Field>}
        <Field label="Reason"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </ConfirmDialog>

      <ConfirmDialog open={dialog === "close"} title="Close case" description="Closing keeps the full history. It does not lift any restriction that is still running." confirmLabel="Close case" confirmDisabled={outcome.trim().length < 3} onCancel={close}
        onConfirm={async () => { const m = await act("close", { outcome }, "Case closed"); if (m) show(m, "error"); }}>
        <Field label="Outcome summary"><Textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} /></Field>
      </ConfirmDialog>

      <ConfirmDialog open={dialog === "note"} title="Add a note" description="Notes are append-only and become part of the case timeline." confirmLabel="Add note" confirmDisabled={note.trim().length < 2} onCancel={close}
        onConfirm={async () => { const r = await callApi(`/api/admin/risk/cases/${caseId}/notes`, "POST", { note }); if (!r.ok) show(r.data.error ?? "Could not add the note", "error"); else { show("Note added", "success"); close(); reload(); } }}>
        <Field label="Note"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </ConfirmDialog>

      <ConfirmDialog open={dialog === "evidence"} title="Add evidence" description="Evidence is integrity-hashed and append-only. Do not paste contact details, documents or sensitive personal data." confirmLabel="Add evidence" confirmDisabled={evidenceSummary.trim().length < 3} onCancel={close}
        onConfirm={async () => { const r = await callApi(`/api/admin/risk/cases/${caseId}/evidence`, "POST", { evidenceType, summary: evidenceSummary, source: "admin" }); if (!r.ok) show(r.data.error ?? "Could not add evidence", "error"); else { show("Evidence added", "success"); close(); reload(); } }}>
        <Field label="Type"><Select value={evidenceType} onChange={(e) => setEvidenceType(e.target.value)}>{["ADMIN_NOTE", "AUDIT_EVENT", "SECURITY_EVENT", "VERIFICATION_RESULT", "PROVIDER_RESULT", "PROFILE_CHANGE", "CONTACT_CHANGE", "SUPPORT_CASE", "USER_REPORT"].map((t) => <option key={t} value={t}>{formatEnumLabel(t)}</option>)}</Select></Field>
        <Field label="Summary"><Textarea value={evidenceSummary} onChange={(e) => setEvidenceSummary(e.target.value)} /></Field>
      </ConfirmDialog>

      <SensitiveActionDialog
        open={dialog === "restrict"} danger title="Restrict this account" confirmLabel="Request restriction"
        description="Choose the narrowest restriction that addresses the concern. Temporary restrictions need an end date; a permanent one needs its own approval."
        onCancel={close}
        onConfirm={async ({ reason: r, stepUpToken }) => {
          if (!checklistDone) return "Complete the review checklist first.";
          if (types.length === 0) return "Choose at least one restriction.";
          if (!permanent && !endDate) return "Choose an end date, or request a permanent restriction.";
          return act("restrict", { reason: r, stepUpToken, checklist, restrictionTypes: types, endDate: permanent ? undefined : new Date(endDate).toISOString(), permanent }, "Restriction applied");
        }}
      >
        <div className="space-y-2">
          <p className="text-xs font-medium">Restrict</p>
          <div className="grid grid-cols-2 gap-1">
            {RESTRICTION_CHOICES.map((o) => <Checkbox key={o.value} label={o.label} checked={types.includes(o.value)} onChange={(e) => setTypes(e.target.checked ? [...types, o.value] : types.filter((t) => t !== o.value))} />)}
          </div>
          <Checkbox label="Permanent (needs a separate permanent-restriction approval)" checked={permanent} onChange={(e) => setPermanent(e.target.checked)} />
          {!permanent && <Field label="Ends on" htmlFor="risk-end"><Input id="risk-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>}
          {checklistUi}
        </div>
      </SensitiveActionDialog>

      <SensitiveActionDialog
        open={dialog === "suspend"} danger title="Suspend this account" confirmLabel="Request suspension"
        description="Suspension is a serious step. It needs the review checklist, your password, a reason and a second approver before anything changes."
        onCancel={close}
        onConfirm={async ({ reason: r, stepUpToken }) => {
          if (!checklistDone) return "Complete the review checklist first.";
          return act("suspend", { reason: r, stepUpToken, checklist }, "Account suspended");
        }}
      >
        {checklistUi}
      </SensitiveActionDialog>
    </div>
  );
}
