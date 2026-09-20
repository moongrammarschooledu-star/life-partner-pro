"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/admin/stat-card";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/utils";
import { Card, Loading, ErrorNote, StatusBadge, useApi, callApi } from "@/components/admin/system/shared";

interface AlertItem {
  id: string; alertCode: string; category: string; severity: string; source: string; service: string; title: string; detail: string | null; status: string;
  occurrences: number; firstSeenAt: string; lastSeenAt: string; assignedTo: string | null; assignedToId: string | null; resolution: string | null;
  incident: { id: string; caseNumber: string; status: string } | null;
  events: Array<{ id: string; fromStatus: string | null; toStatus: string | null; note: string | null; createdAt: string }>;
}

const STATUSES = ["NEW", "ACKNOWLEDGED", "INVESTIGATING", "MITIGATING", "RESOLVED", "CLOSED"];

export function AlertsClient({ canManage }: { canManage: boolean }) {
  const { show } = useToast();
  const [status, setStatus] = useState("OPEN");
  const [severity, setSeverity] = useState("");
  const qs = new URLSearchParams({ ...(status ? { status } : {}), ...(severity ? { severity } : {}) }).toString();
  const { data, error, loading, reload } = useApi<{ items: AlertItem[]; openBySeverity: Record<string, number>; admins: Array<{ id: string; name: string }> }>(`/api/admin/system/alerts?${qs}`);
  const [target, setTarget] = useState<{ alert: AlertItem; toStatus: string } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>, done = "Updated") {
    setBusy(true);
    try {
      const res = await callApi("/api/admin/system/alerts", "PATCH", body);
      if (res.ok) { show(done, "success"); reload(); return true; }
      show(res.data.error ?? "Could not update", "error");
      return false;
    } finally { setBusy(false); }
  }
  async function post(body: Record<string, unknown>, done: string) {
    setBusy(true);
    try {
      const res = await callApi<{ caseNumber?: string; raised?: number; resolved?: number }>("/api/admin/system/alerts", "POST", body);
      if (res.ok) { show(res.data.caseNumber ? `Incident ${res.data.caseNumber} opened` : done, "success"); reload(); } else show(res.data.error ?? "Failed", "error");
    } finally { setBusy(false); }
  }

  const open = data?.openBySeverity ?? {};

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Alerts &amp; Incidents</h1>
          <p className="text-sm text-muted">Monitoring alerts raised by rules on real system state (errors, database, backups, payments, security, capacity…). CRITICAL alerts automatically open a Case Management incident (LPP-INC-######).</p>
        </div>
        {canManage && <Button size="sm" variant="outline" disabled={busy} onClick={() => post({ action: "evaluate" }, "Alert rules evaluated")}>Evaluate rules now</Button>}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={Bell} label="Open critical" value={open.CRITICAL ?? 0} accent={(open.CRITICAL ?? 0) > 0 ? "danger" : "success"} />
        <StatCard icon={Bell} label="Open high" value={open.HIGH ?? 0} accent={(open.HIGH ?? 0) > 0 ? "warning" : "success"} />
        <StatCard icon={Bell} label="Open warning" value={open.WARNING ?? 0} accent="muted" />
        <StatCard icon={Bell} label="Open info" value={open.INFO ?? 0} accent="muted" />
      </div>

      <div className="flex flex-wrap gap-2">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44" aria-label="Status"><option value="OPEN">Open (not resolved)</option><option value="">All</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</Select>
        <Select value={severity} onChange={(e) => setSeverity(e.target.value)} className="w-44" aria-label="Severity"><option value="">Any severity</option>{["INFO", "WARNING", "HIGH", "CRITICAL"].map((s) => <option key={s}>{s}</option>)}</Select>
      </div>

      {loading && !data ? <Loading /> : error ? <ErrorNote message={error} /> : !data || data.items.length === 0 ? (
        <EmptyState icon={Bell} title="No alerts match" description="Nothing is currently wrong according to the configured rules." />
      ) : (
        <div className="space-y-3">
          {data.items.map((a) => (
            <Card key={a.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs">{a.alertCode}</span><StatusBadge status={a.severity} /><StatusBadge status={a.status} /><span className="text-xs text-muted">{a.category} · {a.service} · source {a.source}</span></div>
                  <div className="mt-1 font-medium">{a.title}</div>
                  {a.detail && <div className="text-sm text-muted">{a.detail}</div>}
                  <div className="mt-1 text-xs text-muted">First {formatDateTime(a.firstSeenAt)} · last {formatDateTime(a.lastSeenAt)} · seen {a.occurrences}× · assigned to {a.assignedTo ?? "nobody"}</div>
                  {a.resolution && <div className="mt-1 text-sm">Resolution: {a.resolution}</div>}
                  {a.incident && <div className="mt-1 text-sm">Incident: <Link className="text-primary hover:underline" href={`/admin/case-management/${a.incident.id}`}>{a.incident.caseNumber}</Link> <span className="text-xs text-muted">({a.incident.status})</span></div>}
                </div>
                {canManage && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Select value={a.assignedToId ?? ""} onChange={(e) => patch({ alertId: a.id, assignedToId: e.target.value || null })} className="h-9 w-40" aria-label="Assign"><option value="">Unassigned</option>{data.admins.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
                    <Select value={a.status} onChange={(e) => { setNote(""); setTarget({ alert: a, toStatus: e.target.value }); }} className="h-9 w-40" aria-label="Status">{STATUSES.map((s) => <option key={s}>{s}</option>)}</Select>
                    {!a.incident && <Button size="sm" variant="outline" disabled={busy} onClick={() => post({ action: "open_incident", alertId: a.id }, "Incident opened")}>Open incident</Button>}
                  </div>
                )}
              </div>
              <button className="mt-2 text-xs text-primary hover:underline" onClick={() => setExpanded(expanded === a.id ? null : a.id)}>{expanded === a.id ? "Hide" : "Show"} audit history ({a.events.length})</button>
              {expanded === a.id && (
                <ul className="mt-2 space-y-1 border-t border-border pt-2 text-xs">
                  {a.events.map((e) => <li key={e.id}><span className="text-muted">{formatDateTime(e.createdAt)}</span> — {e.fromStatus && e.toStatus ? `${e.fromStatus} → ${e.toStatus}` : e.toStatus ?? "note"}{e.note ? `: ${e.note}` : ""}</li>)}
                </ul>
              )}
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={target != null}
        title={target ? `Move ${target.alert.alertCode} to ${target.toStatus}` : "Change status"}
        description={target && (target.toStatus === "RESOLVED" || target.toStatus === "CLOSED") ? "A resolution note is required." : "Optionally add a note for the audit history."}
        confirmDisabled={busy || Boolean(target && (target.toStatus === "RESOLVED" || target.toStatus === "CLOSED") && !note.trim())}
        onCancel={() => setTarget(null)}
        onConfirm={async () => {
          if (!target) return;
          if (await patch({ alertId: target.alert.id, toStatus: target.toStatus, note }, "Status updated")) setTarget(null);
        }}
      >
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note / resolution" aria-label="Note" />
      </ConfirmDialog>
    </div>
  );
}
