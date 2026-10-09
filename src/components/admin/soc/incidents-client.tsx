"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { Card, ErrorNote, Loading, SensitiveActionDialog, StatusBadge, callApi, useApi } from "@/components/admin/system/shared";
import { SeverityBadge, SocHeader, Source, Table, fmt, makeCan } from "@/components/admin/soc/shared";

const CATEGORIES = ["ACCOUNT_COMPROMISE", "AUTHENTICATION_ATTACK", "AUTHORIZATION_FAILURE", "DATA_EXPOSURE", "PRIVACY_INCIDENT", "MALICIOUS_ATTACHMENT", "API_ATTACK", "WEBHOOK_COMPROMISE", "PAYMENT_SECURITY", "AI_SECURITY", "DOCUMENT_ACCESS", "BACKUP_RECOVERY_FAILURE", "THIRD_PARTY_PROVIDER"];
const FLOW = ["DETECTED", "TRIAGED", "INVESTIGATING", "CONTAINMENT", "REMEDIATION", "RECOVERY", "POST_INCIDENT_REVIEW", "CLOSED"];
const pretty = (s: string) => s.replace(/_/g, " ").toLowerCase();

interface IncidentRow { id: string; incidentCode: string; title: string; category: string; severity: string; status: string; ownerId: string | null; createdAt: string }

export function IncidentsClient({ permissions }: { permissions: string[] }) {
  const can = makeCan(permissions);
  const { show } = useToast();
  const [filter, setFilter] = useState("OPEN");
  const { data, error, loading, reload } = useApi<{ items: IncidentRow[] }>(`/api/admin/soc/incidents?status=${filter}`);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: "", category: "AUTHENTICATION_ATTACK", severity: "MEDIUM", summary: "" });

  async function create() {
    const res = await callApi<{ id?: string }>("/api/admin/soc/incidents", "POST", form);
    if (!res.ok) return show(res.data.error ?? "The incident was not created.", "error");
    show("Incident opened.", "success");
    setCreating(false);
    setForm({ title: "", category: "AUTHENTICATION_ATTACK", severity: "MEDIUM", summary: "" });
    reload();
  }

  return (
    <div className="space-y-4">
      <SocHeader title="Incident response" description="An incident is a tracked response to something confirmed or strongly suspected. Each one has an owner, a timeline, evidence references (never copies of data), any containment taken, a root cause and lessons learned." can={can} />
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Field label="Show" htmlFor="inc-filter">
            <Select id="inc-filter" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="OPEN">All open</option>
              {FLOW.map((s) => <option key={s} value={s}>{pretty(s)}</option>)}
            </Select>
          </Field>
          {can("soc:incidents:manage") && <Button size="sm" onClick={() => setCreating((v) => !v)}>{creating ? "Cancel" : "Open an incident"}</Button>}
        </div>
        {creating && (
          <div className="mt-4 grid gap-3 border-t border-border pt-4 md:grid-cols-2">
            <Field label="Title" htmlFor="inc-title"><Input id="inc-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Category" htmlFor="inc-cat"><Select id="inc-cat" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c} value={c}>{pretty(c)}</option>)}</Select></Field>
            <Field label="Severity" htmlFor="inc-sev"><Select id="inc-sev" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>{["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"].map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
            <Field label="What was seen (no personal details)" htmlFor="inc-sum" className="md:col-span-2"><Textarea id="inc-sum" rows={3} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} /></Field>
            <div><Button onClick={create} disabled={form.title.trim().length < 5 || form.summary.trim().length < 10}>Open incident</Button></div>
          </div>
        )}
      </Card>
      {loading && <Loading />}
      {error && <ErrorNote message={error} />}
      {data && (
        <Card>
          {data.items.length === 0 ? <EmptyState title="No incidents" description="None match this filter." /> : (
            <Table head={["Incident", "Category", "Severity", "Stage", "Opened"]}>
              {data.items.map((i) => (
                <tr key={i.id}>
                  <td className="px-2 py-2"><Link className="font-medium text-primary hover:underline" href={`/admin/security-operations/incidents/${i.id}`}>{i.incidentCode}</Link><div className="text-xs text-muted">{i.title}</div></td>
                  <td className="px-2 py-2 text-muted">{pretty(i.category)}</td>
                  <td className="px-2 py-2"><SeverityBadge severity={i.severity} /></td>
                  <td className="px-2 py-2"><StatusBadge status={i.status} /></td>
                  <td className="px-2 py-2 text-muted">{fmt(i.createdAt)}</td>
                </tr>
              ))}
            </Table>
          )}
          <Source>SocIncident</Source>
        </Card>
      )}
    </div>
  );
}

interface Containment { id: string; actionType: string; impact: string; status: string; reason: string; requestedById: string; approvedById: string | null; result: string | null; params: Record<string, unknown>; createdAt: string }
interface IncidentDetail extends IncidentRow {
  summary: string; evidenceRefs: Array<{ type: string; id: string; note?: string }> | null; communicationPlan: string | null; rootCause: string | null; lessonsLearned: string | null;
  events: Array<{ id: string; kind: string; actorId: string | null; fromStatus: string | null; toStatus: string | null; note: string | null; createdAt: string }>; containment: Containment[];
}

const ACTIONS: Record<string, string> = { REVOKE_SESSION: "End one admin session", REVOKE_ADMIN_SESSIONS: "End all sessions of an administrator", THROTTLE_SUBJECT: "Throttle an account", BLOCK_NETWORK_HASH: "Block a network (by its hash)", EMERGENCY_SWITCH: "Turn on an emergency switch" };
const SWITCHES = ["payments", "registrations", "profileSubmissions", "matching", "proposals", "notifications", "uploads", "publicAccess"];

export function IncidentDetailClient({ id, permissions, adminId }: { id: string; permissions: string[]; adminId: string }) {
  const can = makeCan(permissions);
  const { show } = useToast();
  const { data, error, loading, reload } = useApi<IncidentDetail>(`/api/admin/soc/incidents/${id}`);
  const [note, setNote] = useState("");
  const [field, setField] = useState<{ name: string; value: string }>({ name: "rootCause", value: "" });
  const [evidence, setEvidence] = useState({ type: "SecurityEvent", refId: "", note: "" });
  const [req, setReq] = useState({ actionType: "REVOKE_SESSION", reason: "", sessionId: "", adminId: "", subjectType: "SUBJECT_KEY", subjectRef: "", ipHash: "", minutes: "30", switchName: "payments" });
  const [decide, setDecide] = useState<{ id: string; decision: "APPROVE" | "REJECT" } | null>(null);

  async function patch(body: Record<string, unknown>, ok: string) {
    const res = await callApi(`/api/admin/soc/incidents/${id}`, "PATCH", body);
    if (!res.ok) return show(res.data.error ?? "That did not work.", "error");
    show(ok, "success");
    setNote("");
    reload();
  }
  async function requestContainment() {
    const params: Record<string, unknown> = {};
    if (req.actionType === "REVOKE_SESSION") params.sessionId = req.sessionId.trim();
    if (req.actionType === "REVOKE_ADMIN_SESSIONS") params.adminId = req.adminId.trim();
    if (req.actionType === "THROTTLE_SUBJECT") Object.assign(params, { subjectType: req.subjectType, subjectRef: req.subjectRef.trim(), minutes: Number(req.minutes) });
    if (req.actionType === "BLOCK_NETWORK_HASH") Object.assign(params, { ipHash: req.ipHash.trim(), minutes: Number(req.minutes) });
    if (req.actionType === "EMERGENCY_SWITCH") params.switch = req.switchName;
    const res = await callApi<{ status?: string; impact?: string; result?: string }>(`/api/admin/soc/incidents/${id}/containment`, "POST", { actionType: req.actionType, params, reason: req.reason });
    if (!res.ok) return show(res.data.error ?? "The request was not accepted.", "error");
    show(res.data.status === "EXECUTED" ? `Done: ${res.data.result}` : "Waiting for a second person to approve.", "success");
    setReq({ ...req, reason: "" });
    reload();
  }

  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? "Could not load the incident."} />;
  const idx = FLOW.indexOf(data.status);
  const nextSteps = data.status === "CLOSED" ? [] : [FLOW[idx + 1], ...(data.status === "INVESTIGATING" ? ["REMEDIATION"] : []), ...(["CONTAINMENT", "REMEDIATION", "RECOVERY"].includes(data.status) ? ["INVESTIGATING"] : [])].filter(Boolean);
  const manage = can("soc:incidents:manage");
  const containable = ["INVESTIGATING", "CONTAINMENT", "REMEDIATION"].includes(data.status);

  return (
    <div className="space-y-4">
      <SocHeader title={`${data.incidentCode} — ${data.title}`} description={`${pretty(data.category)} · opened ${fmt(data.createdAt)}`} can={can} />
      <Card title="Stage" action={<SeverityBadge severity={data.severity} />}>
        <ol className="flex flex-wrap gap-2 text-xs" aria-label="Incident stages">
          {FLOW.map((s, i) => <li key={s} aria-current={s === data.status ? "step" : undefined} className={`rounded-full px-3 py-1 ${s === data.status ? "bg-primary text-primary-foreground" : i < idx ? "bg-success/10 text-success" : "bg-surface-muted text-muted"}`}>{pretty(s)}</li>)}
        </ol>
        <p className="mt-3 text-sm">{data.summary}</p>
        <p className="mt-1 text-sm text-muted">Owner: {data.ownerId ? (data.ownerId === adminId ? "you" : data.ownerId) : "not assigned"}</p>
        {manage && data.status !== "CLOSED" && (
          <div className="mt-3 space-y-2 border-t border-border pt-3">
            <Field label="Note for this step (needed to skip containment)" htmlFor="inc-note"><Input id="inc-note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <div className="flex flex-wrap gap-2">
              {nextSteps.map((s) => <Button key={s} size="sm" variant={s === FLOW[idx + 1] ? "primary" : "outline"} onClick={() => patch({ action: "MOVE", to: s, note }, `Moved to ${pretty(s)}.`)}>{s === "INVESTIGATING" && idx > 2 ? "Reopen investigation" : `Move to ${pretty(s)}`}</Button>)}
              {data.ownerId !== adminId && <Button size="sm" variant="outline" onClick={() => patch({ action: "OWNER", ownerId: adminId }, "You are now the owner.")}>Take ownership</Button>}
            </div>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Review">
          {(["rootCause", "lessonsLearned", "communicationPlan"] as const).map((f) => (
            <div key={f} className="mb-3 text-sm"><p className="font-medium">{f === "rootCause" ? "Root cause" : f === "lessonsLearned" ? "Lessons learned" : "Communication plan"}</p><p className="text-muted">{data[f] ?? "Not recorded yet."}</p></div>
          ))}
          {manage && data.status !== "CLOSED" && (
            <div className="space-y-2 border-t border-border pt-3">
              <Select aria-label="Field to record" value={field.name} onChange={(e) => setField({ ...field, name: e.target.value })}><option value="rootCause">Root cause</option><option value="lessonsLearned">Lessons learned</option><option value="communicationPlan">Communication plan</option></Select>
              <Textarea aria-label="Text to record" rows={3} value={field.value} onChange={(e) => setField({ ...field, value: e.target.value })} />
              <Button size="sm" disabled={field.value.trim().length < 10} onClick={async () => { await patch({ action: "FIELD", field: field.name, value: field.value }, "Recorded."); setField({ ...field, value: "" }); }}>Record</Button>
              <p className="text-xs text-muted">Closing needs the root cause and lessons learned; a high or critical incident also needs its communication plan.</p>
            </div>
          )}
        </Card>
        <Card title="Evidence (references only)">
          {(data.evidenceRefs ?? []).length === 0 ? <p className="text-sm text-muted">No evidence linked yet.</p> : <ul className="space-y-1 text-sm">{(data.evidenceRefs ?? []).map((e) => <li key={`${e.type}-${e.id}`}><span className="font-medium">{e.type}</span> <span className="text-muted">{e.id}{e.note ? ` — ${e.note}` : ""}</span></li>)}</ul>}
          {manage && data.status !== "CLOSED" && (
            <div className="mt-3 grid gap-2 border-t border-border pt-3">
              <Select aria-label="Evidence type" value={evidence.type} onChange={(e) => setEvidence({ ...evidence, type: e.target.value })}>{["SecurityEvent", "SocAlert", "AuditLog", "BackupRun", "WebhookEvent", "AiRequest", "RiskCase", "Case", "AdminSession", "Other"].map((t) => <option key={t}>{t}</option>)}</Select>
              <Input aria-label="Record identifier" placeholder="Record identifier (an id, not content)" value={evidence.refId} onChange={(e) => setEvidence({ ...evidence, refId: e.target.value })} />
              <Input aria-label="Short note" placeholder="Short note (optional)" value={evidence.note} onChange={(e) => setEvidence({ ...evidence, note: e.target.value })} />
              <div><Button size="sm" variant="outline" disabled={evidence.refId.trim().length < 3} onClick={async () => { await patch({ action: "EVIDENCE", type: evidence.type, refId: evidence.refId, note: evidence.note }, "Evidence linked."); setEvidence({ ...evidence, refId: "", note: "" }); }}>Link evidence</Button></div>
            </div>
          )}
        </Card>
      </div>

      <Card title="Containment">
        <p className="mb-3 text-sm text-muted">Containment is a technical, time-limited control against an active attack — never a decision about a person. Narrow actions run at once; broad ones wait for a different person to approve. Nobody approves their own request or can be the target of their own containment.</p>
        {data.containment.length === 0 ? <p className="text-sm text-muted">No containment requested.</p> : (
          <Table head={["Action", "Impact", "Status", "Reason", "Result", ""]}>
            {data.containment.map((c) => (
              <tr key={c.id}>
                <td className="px-2 py-2">{ACTIONS[c.actionType] ?? c.actionType}</td><td className="px-2 py-2">{c.impact}</td><td className="px-2 py-2"><StatusBadge status={c.status} /></td>
                <td className="px-2 py-2 text-muted">{c.reason}</td><td className="px-2 py-2 text-muted">{c.result ?? "—"}</td>
                <td className="px-2 py-2">{c.status === "REQUESTED" && can("soc:containment:approve") && c.requestedById !== adminId && <div className="flex gap-1"><Button size="sm" onClick={() => setDecide({ id: c.id, decision: "APPROVE" })}>Approve</Button><Button size="sm" variant="outline" onClick={() => setDecide({ id: c.id, decision: "REJECT" })}>Reject</Button></div>}</td>
              </tr>
            ))}
          </Table>
        )}
        {can("soc:containment:request") && containable && (
          <div className="mt-4 grid gap-3 border-t border-border pt-4 md:grid-cols-2">
            <Field label="Action" htmlFor="c-action"><Select id="c-action" value={req.actionType} onChange={(e) => setReq({ ...req, actionType: e.target.value })}>{Object.entries(ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            {req.actionType === "REVOKE_SESSION" && <Field label="Session id" htmlFor="c-sess"><Input id="c-sess" value={req.sessionId} onChange={(e) => setReq({ ...req, sessionId: e.target.value })} /></Field>}
            {req.actionType === "REVOKE_ADMIN_SESSIONS" && <Field label="Administrator id" htmlFor="c-adm"><Input id="c-adm" value={req.adminId} onChange={(e) => setReq({ ...req, adminId: e.target.value })} /></Field>}
            {req.actionType === "THROTTLE_SUBJECT" && <><Field label="Subject type" htmlFor="c-st"><Select id="c-st" value={req.subjectType} onChange={(e) => setReq({ ...req, subjectType: e.target.value })}><option value="SUBJECT_KEY">Account hash</option><option value="PROFILE">Profile</option><option value="ADMIN">Administrator</option></Select></Field><Field label="Subject reference" htmlFor="c-sr"><Input id="c-sr" value={req.subjectRef} onChange={(e) => setReq({ ...req, subjectRef: e.target.value })} /></Field></>}
            {req.actionType === "BLOCK_NETWORK_HASH" && <Field label="Network hash" htmlFor="c-ip"><Input id="c-ip" value={req.ipHash} onChange={(e) => setReq({ ...req, ipHash: e.target.value })} /></Field>}
            {(req.actionType === "THROTTLE_SUBJECT" || req.actionType === "BLOCK_NETWORK_HASH") && <Field label="Minutes (1–1440)" hint="Short actions run now; longer ones need approval." htmlFor="c-min"><Input id="c-min" type="number" min={1} max={1440} value={req.minutes} onChange={(e) => setReq({ ...req, minutes: e.target.value })} /></Field>}
            {req.actionType === "EMERGENCY_SWITCH" && <Field label="Switch" hint="Always needs approval. Turn it off again in System Control." htmlFor="c-sw"><Select id="c-sw" value={req.switchName} onChange={(e) => setReq({ ...req, switchName: e.target.value })}>{SWITCHES.map((s) => <option key={s}>{s}</option>)}</Select></Field>}
            <Field label="Why is this needed?" htmlFor="c-why" className="md:col-span-2"><Textarea id="c-why" rows={2} value={req.reason} onChange={(e) => setReq({ ...req, reason: e.target.value })} /></Field>
            <div><Button onClick={requestContainment} disabled={req.reason.trim().length < 10}>Request</Button></div>
          </div>
        )}
      </Card>

      <Card title="Timeline">
        <ol className="space-y-1 text-sm">
          {data.events.map((e) => <li key={e.id} className="flex flex-wrap gap-x-2 text-muted"><span>{fmt(e.createdAt)}</span><span className="text-foreground">{e.kind.toLowerCase()}{e.toStatus ? ` → ${pretty(e.toStatus)}` : ""}</span>{e.note && <span>— {e.note}</span>}{e.actorId && <span>({e.actorId})</span>}</li>)}
        </ol>
        {manage && data.status !== "CLOSED" && (
          <div className="mt-3 flex gap-2 border-t border-border pt-3"><Input aria-label="Timeline note" placeholder="Add a note to the timeline" value={note} onChange={(e) => setNote(e.target.value)} /><Button size="sm" variant="outline" disabled={note.trim().length < 3} onClick={() => patch({ action: "NOTE", note }, "Note added.")}>Add</Button></div>
        )}
      </Card>

      <SensitiveActionDialog
        open={!!decide}
        title={decide?.decision === "APPROVE" ? "Approve this containment action" : "Reject this containment request"}
        description="Approving runs the action immediately. Confirm your password to continue."
        danger={decide?.decision === "APPROVE"}
        onCancel={() => setDecide(null)}
        onConfirm={async ({ reason, stepUpToken }) => {
          const res = await callApi(`/api/admin/soc/containment/${decide!.id}`, "POST", { decision: decide!.decision, note: reason, stepUpToken });
          if (!res.ok) return res.data.error ?? "The decision was not recorded.";
          show(decide!.decision === "APPROVE" ? "Approved and carried out." : "Rejected.", "success");
          setDecide(null);
          reload();
        }}
      />
    </div>
  );
}
