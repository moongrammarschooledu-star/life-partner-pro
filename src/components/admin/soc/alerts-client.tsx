"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { Card, ErrorNote, Loading, StatusBadge, callApi, useApi } from "@/components/admin/system/shared";
import { SeverityBadge, SocHeader, Source, Table, fmt, makeCan } from "@/components/admin/soc/shared";

interface AlertRow { id: string; alertCode: string; ruleKey: string; category: string; severity: string; status: string; title: string; summary: string; source: string; affectedResource: string | null; occurrences: number; createdAt: string; lastSeenAt: string; assignedToId: string | null; escalationLevel: number }
interface AlertDetail extends AlertRow { evidenceRefs: Array<{ type: string; id: string }> | null; resolution: string | null; acknowledgedAt: string | null; incidentId: string | null; events: Array<{ id: string; kind: string; actorId: string | null; fromStatus: string | null; toStatus: string | null; note: string | null; createdAt: string }> }

// What each state may move to (mirrors the server's state machine; the server is the one that enforces it).
const NEXT: Record<string, Array<{ to: string; label: string; needsNote?: boolean; variant?: "primary" | "outline" | "danger" }>> = {
  NEW: [{ to: "ACKNOWLEDGED", label: "Acknowledge", variant: "primary" }, { to: "ESCALATED", label: "Escalate", variant: "outline" }, { to: "FALSE_POSITIVE", label: "Mark false positive", needsNote: true, variant: "outline" }],
  ACKNOWLEDGED: [{ to: "INVESTIGATING", label: "Start investigating", variant: "primary" }, { to: "ESCALATED", label: "Escalate", variant: "outline" }, { to: "FALSE_POSITIVE", label: "Mark false positive", needsNote: true, variant: "outline" }],
  INVESTIGATING: [{ to: "RESOLVED", label: "Resolve", needsNote: true, variant: "primary" }, { to: "ESCALATED", label: "Escalate", variant: "outline" }, { to: "FALSE_POSITIVE", label: "Mark false positive", needsNote: true, variant: "outline" }],
  ESCALATED: [{ to: "ACKNOWLEDGED", label: "Acknowledge", variant: "primary" }, { to: "INVESTIGATING", label: "Start investigating", variant: "outline" }, { to: "RESOLVED", label: "Resolve", needsNote: true, variant: "outline" }, { to: "FALSE_POSITIVE", label: "Mark false positive", needsNote: true, variant: "outline" }],
  RESOLVED: [{ to: "CLOSED", label: "Close", variant: "primary" }, { to: "INVESTIGATING", label: "Reopen", variant: "outline" }],
  FALSE_POSITIVE: [{ to: "CLOSED", label: "Close", variant: "primary" }],
  CLOSED: [],
};

export function AlertsClient({ permissions, adminId }: { permissions: string[]; adminId: string }) {
  const can = makeCan(permissions);
  const params = useSearchParams();
  const [status, setStatus] = useState("OPEN");
  const [severity, setSeverity] = useState("");
  const [openId, setOpenId] = useState<string | null>(params.get("open"));
  const { data, error, loading, reload } = useApi<{ items: AlertRow[] }>(`/api/admin/soc/alerts?status=${status}${severity ? `&severity=${severity}` : ""}`);

  return (
    <div className="space-y-4">
      <SocHeader title="Security alerts" description="Raised by the detection rules. An alert states what was counted and where — it is never a conclusion about a person. Work each one through acknowledge → investigate → resolve; resolving or dismissing needs a written reason." can={can} />
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Show" htmlFor="alert-status">
            <Select id="alert-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              {["OPEN", "NEW", "ACKNOWLEDGED", "INVESTIGATING", "ESCALATED", "RESOLVED", "FALSE_POSITIVE", "CLOSED"].map((s) => <option key={s} value={s}>{s === "OPEN" ? "All open" : s.replace(/_/g, " ").toLowerCase()}</option>)}
            </Select>
          </Field>
          <Field label="Severity" htmlFor="alert-severity">
            <Select id="alert-severity" value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="">Any</option>
              {["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"].map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Button variant="outline" size="sm" onClick={reload}>Refresh</Button>
        </div>
      </Card>
      {loading && <Loading />}
      {error && <ErrorNote message={error} />}
      {data && (
        <Card>
          {data.items.length === 0 ? <EmptyState title="No alerts match" description="Nothing has been raised for this filter." /> : (
            <Table head={["Alert", "Severity", "Status", "What was seen", "Seen", ""]}>
              {data.items.map((a) => (
                <tr key={a.id} className={openId === a.id ? "bg-surface-muted" : undefined}>
                  <td className="px-2 py-2"><div className="font-medium">{a.alertCode}</div><div className="text-xs text-muted">{a.title}</div></td>
                  <td className="px-2 py-2"><SeverityBadge severity={a.severity} /></td>
                  <td className="px-2 py-2"><StatusBadge status={a.status} />{a.escalationLevel > 0 && <div className="text-xs text-muted">escalation level {a.escalationLevel}</div>}</td>
                  <td className="px-2 py-2 text-muted">{a.summary}<div className="text-xs">{a.affectedResource ?? a.source}</div></td>
                  <td className="px-2 py-2 text-muted">{fmt(a.lastSeenAt)}{a.occurrences > 1 && <div className="text-xs">seen {a.occurrences} times</div>}</td>
                  <td className="px-2 py-2"><Button size="sm" variant="outline" onClick={() => setOpenId(openId === a.id ? null : a.id)}>{openId === a.id ? "Hide" : "Open"}</Button></td>
                </tr>
              ))}
            </Table>
          )}
          <Source>SocAlert</Source>
        </Card>
      )}
      {openId && <AlertPanel id={openId} can={can} adminId={adminId} onChanged={reload} />}
    </div>
  );
}

function AlertPanel({ id, can, adminId, onChanged }: { id: string; can: (p: string) => boolean; adminId: string; onChanged: () => void }) {
  const { show } = useToast();
  const { data, error, loading, reload } = useApi<AlertDetail>(`/api/admin/soc/alerts/${id}`);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function patch(body: Record<string, unknown>, ok: string) {
    setBusy(true);
    const res = await callApi(`/api/admin/soc/alerts/${id}`, "PATCH", body);
    setBusy(false);
    if (!res.ok) return show(res.data.error ?? "That did not work.", "error");
    show(ok, "success");
    setNote("");
    reload();
    onChanged();
  }

  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? "Could not load the alert."} />;
  const moves = can("soc:alerts:manage") ? NEXT[data.status] ?? [] : [];
  return (
    <Card title={`${data.alertCode} — ${data.title}`} action={<SeverityBadge severity={data.severity} />}>
      <dl className="grid gap-x-6 gap-y-1 text-sm md:grid-cols-2">
        <div><dt className="inline text-muted">Status: </dt><dd className="inline"><StatusBadge status={data.status} /></dd></div>
        <div><dt className="inline text-muted">Rule: </dt><dd className="inline">{data.ruleKey}</dd></div>
        <div><dt className="inline text-muted">Source: </dt><dd className="inline">{data.source}</dd></div>
        <div><dt className="inline text-muted">Affected resource: </dt><dd className="inline">{data.affectedResource ?? "—"}</dd></div>
        <div><dt className="inline text-muted">Assigned to: </dt><dd className="inline">{data.assignedToId ? (data.assignedToId === adminId ? "you" : data.assignedToId) : "nobody"}</dd></div>
        <div><dt className="inline text-muted">Acknowledged: </dt><dd className="inline">{fmt(data.acknowledgedAt)}</dd></div>
      </dl>
      <p className="mt-3 text-sm">{data.summary}</p>
      {data.evidenceRefs && data.evidenceRefs.length > 0 && (
        <p className="mt-2 text-xs text-muted">Evidence (references only): {data.evidenceRefs.map((e) => `${e.type} ${e.id}`).join(" · ")}</p>
      )}
      {data.resolution && <p className="mt-2 rounded-lg bg-surface-muted p-3 text-sm"><span className="text-muted">Resolution: </span>{data.resolution}</p>}
      {data.incidentId && <p className="mt-2 text-sm text-muted">Part of an incident.</p>}

      {can("soc:alerts:manage") && data.status !== "CLOSED" && (
        <div className="mt-4 space-y-3 border-t border-border pt-3">
          <Field label="Note or resolution (required to resolve or dismiss)" htmlFor="alert-note"><Textarea id="alert-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="flex flex-wrap gap-2">
            {moves.map((m) => <Button key={m.to} size="sm" variant={m.variant ?? "outline"} disabled={busy || (m.needsNote && note.trim().length < 10)} onClick={() => patch({ action: "STATUS", to: m.to, note }, `Alert ${m.label.toLowerCase()}.`)}>{m.label}</Button>)}
            <Button size="sm" variant="outline" disabled={busy || note.trim().length < 3} onClick={() => patch({ action: "NOTE", note }, "Note added.")}>Add note</Button>
            {data.assignedToId !== adminId && <Button size="sm" variant="outline" disabled={busy} onClick={() => patch({ action: "ASSIGN", assigneeId: adminId }, "Assigned to you.")}>Assign to me</Button>}
            {data.assignedToId && <Button size="sm" variant="ghost" disabled={busy} onClick={() => patch({ action: "ASSIGN", assigneeId: "" }, "Unassigned.")}>Unassign</Button>}
          </div>
        </div>
      )}

      <h4 className="mt-4 text-sm font-medium">History</h4>
      <ol className="mt-2 space-y-1 text-sm">
        {data.events.map((e) => (
          <li key={e.id} className="flex flex-wrap gap-x-2 text-muted"><span>{fmt(e.createdAt)}</span><span className="text-foreground">{e.kind.toLowerCase()}{e.toStatus ? ` → ${e.toStatus.toLowerCase().replace(/_/g, " ")}` : ""}</span>{e.note && <span>— {e.note}</span>}{e.actorId && <span>({e.actorId})</span>}</li>
        ))}
      </ol>
    </Card>
  );
}
