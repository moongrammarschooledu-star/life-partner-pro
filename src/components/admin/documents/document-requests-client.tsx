"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { Card, ErrorNote, Loading, StatusBadge, callApi, timeAgo, useApi } from "@/components/admin/system/shared";
import { formatEnumLabel } from "@/lib/utils";

interface RequestRow { id: string; requestCode: string; typeKey: string; purpose: string; requestedFromType: string; requestedFromId: string; status: string; priority: string; dueDate: string | null; createdAt: string }

export function DocumentRequestsClient({ canManage }: { canManage: boolean }) {
  const { data, error, loading, reload } = useApi<{ items: RequestRow[] }>("/api/admin/document-requests");
  const { show } = useToast();
  const [creating, setCreating] = useState(false);

  async function cancel(id: string) {
    const reason = window.prompt("Reason for cancelling (required)");
    if (!reason) return;
    const r = await callApi(`/api/admin/document-requests/${id}`, "PATCH", { status: "CANCELLED", reason });
    if (!r.ok) show((r.data as { error?: string }).error ?? "Could not cancel", "error");
    else { show("Request cancelled", "success"); reload(); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Document Requests</h1>
          <p className="text-sm text-muted">Ask an applicant for a specific document. They see the reason, deadline and instructions — never threatening language.</p>
        </div>
        {canManage && <Button onClick={() => setCreating((v) => !v)}>{creating ? "Close" : "New request"}</Button>}
      </div>
      {creating && <RequestForm onDone={() => { setCreating(false); reload(); }} />}
      {loading && !data && <Loading />}
      {error && <ErrorNote message={error} />}
      {data && data.items.length === 0 && <EmptyState title="No document requests" />}
      {data && data.items.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {data.items.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs">{r.requestCode}</span>
                <Badge>{formatEnumLabel(r.typeKey)}</Badge>
                <StatusBadge status={r.status} />
                <span className="text-muted">{r.purpose}</span>
                {r.dueDate && <span className="text-xs text-muted">due {new Date(r.dueDate).toLocaleDateString()}</span>}
              </span>
              <span className="flex items-center gap-2">
                <span className="text-xs text-muted">{timeAgo(r.createdAt)}</span>
                {canManage && !["COMPLETED", "CANCELLED", "EXPIRED"].includes(r.status) && <Button size="sm" variant="danger" onClick={() => cancel(r.id)}>Cancel</Button>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RequestForm({ onDone }: { onDone: () => void }) {
  const { show } = useToast();
  const [f, setF] = useState({ typeKey: "", purpose: "", requestedFromType: "PROFILE", requestedFromId: "", dueDate: "", priority: "NORMAL", instructions: "" });
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  async function submit() {
    const r = await callApi("/api/admin/document-requests", "POST", { ...f, dueDate: f.dueDate || undefined, instructions: f.instructions || undefined });
    if (!r.ok) show((r.data as { error?: string }).error ?? "Could not create the request", "error");
    else { show("Request sent", "success"); onDone(); }
  }
  return (
    <Card title="New document request">
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Document type key" hint="e.g. PASSPORT, EDUCATIONAL_CERTIFICATE"><Input value={f.typeKey} onChange={(e) => set("typeKey", e.target.value.trim().toUpperCase())} /></Field>
        <Field label="Requested from"><Select value={f.requestedFromType} onChange={(e) => set("requestedFromType", e.target.value)}><option value="PROFILE">Applicant</option><option value="FAMILY_MEMBER">Family member</option></Select></Field>
        <Field label="Profile / family member id"><Input value={f.requestedFromId} onChange={(e) => set("requestedFromId", e.target.value.trim())} /></Field>
        <Field label="Due date (optional)"><Input type="date" value={f.dueDate} onChange={(e) => set("dueDate", e.target.value)} /></Field>
        <Field label="Priority"><Select value={f.priority} onChange={(e) => set("priority", e.target.value)}>{["LOW", "NORMAL", "HIGH", "URGENT"].map((p) => <option key={p} value={p}>{p}</option>)}</Select></Field>
      </div>
      <Field label="Purpose"><Input value={f.purpose} onChange={(e) => set("purpose", e.target.value)} /></Field>
      <Field label="Instructions (optional)"><Textarea rows={3} value={f.instructions} onChange={(e) => set("instructions", e.target.value)} /></Field>
      <Button onClick={submit} disabled={!f.typeKey || !f.purpose || !f.requestedFromId}>Send request</Button>
    </Card>
  );
}
