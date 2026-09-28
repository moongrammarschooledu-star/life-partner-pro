"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Select, Textarea } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { Card, ErrorNote, KV, Loading, StatusBadge, callApi, useApi } from "@/components/admin/system/shared";
import { formatDateTime, formatEnumLabel } from "@/lib/utils";
import { FALSE_POSITIVE_CHOICES } from "@/components/admin/risk/risk-shared";

interface Cluster { id: string; status: string; confidenceBand: string; memberCount: number; members: Array<{ profileId: string; profileCode: string | null }>; createdAt: string }
interface ClusterDetail {
  cluster: Cluster;
  members: Array<{ profileId: string; profileCode: string; fullName?: string; status: string; verified: boolean; city?: string; country?: string; registeredAt: string }>;
  candidates: Array<{ candidateCode: string; profileId: string; candidateProfileId: string; confidenceBand: string; matchingSignals: string[]; status: string }>;
  relationships: Array<{ profileId: string; relatedProfileId: string; relationshipType: string }>;
}
interface MergePlan { plan: { suggestedSurvivorId: string; blockedReason: string | null; preservationChecklist: string[]; approval: { approvalCode: string; status: string } | null; members: Array<{ profileId: string; proposals: number; cases: number; payments: number; verificationDocuments: number; activeHold: boolean }> } }

export function RiskDuplicatesClient({ permissions }: { permissions: string[] }) {
  const can = (p: string) => permissions.includes(p);
  const [status, setStatus] = useState("UNRESOLVED");
  const list = useApi<{ items: Cluster[] }>(`/api/admin/risk/duplicates?status=${status}`);
  const [openId, setOpenId] = useState<string | null>(null);
  const { show } = useToast();

  async function rebuild() {
    const r = await callApi<{ clusters: number; created: number }>("/api/admin/risk/duplicates/rebuild", "POST", {});
    if (!r.ok) show(r.data.error ?? "Could not rebuild", "error");
    else { show(`Rebuilt: ${r.data.clusters} cluster(s), ${r.data.created} new`, "success"); list.reload(); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/admin/risk-center" className="text-sm text-primary hover:underline">← Risk &amp; Safety Center</Link>
          <h1 className="text-xl font-semibold">Duplicate clusters</h1>
          <p className="text-sm text-muted">Groups of accounts that may belong to one person — or to relatives. Only contact identifiers, name with birth date and verified references are compared; religion, ethnicity, family background, income and appearance are never used.</p>
        </div>
        <div className="flex gap-2">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44"><option value="UNRESOLVED">Unresolved</option><option value="CONFIRMED">Confirmed</option><option value="FALSE_POSITIVE">False positives</option><option value="RESOLVED">Resolved</option></Select>
          {can("duplicates:manage") && <Button variant="outline" onClick={rebuild}>Rebuild clusters</Button>}
        </div>
      </div>
      {list.loading && !list.data && <Loading />}
      {list.error && <ErrorNote message={list.error} />}
      {list.data && list.data.items.length === 0 && <EmptyState title="No clusters" description="Nothing needs review in this state." />}
      {list.data?.items.map((c) => (
        <Card key={c.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <StatusBadge status={c.status} />
              <Badge variant="muted">{formatEnumLabel(c.confidenceBand)} confidence</Badge>
              <span>{c.memberCount} accounts:</span>
              <span className="font-mono text-xs">{c.members.map((m) => m.profileCode ?? "?").join(", ")}</span>
            </div>
            <Button size="sm" variant="outline" onClick={() => setOpenId(openId === c.id ? null : c.id)}>{openId === c.id ? "Hide" : "Review"}</Button>
          </div>
          {openId === c.id && <ClusterReview id={c.id} can={can} onChanged={() => { setOpenId(null); list.reload(); }} />}
        </Card>
      ))}
    </div>
  );
}

function ClusterReview({ id, can, onChanged }: { id: string; can: (p: string) => boolean; onChanged: () => void }) {
  const { data, error, loading } = useApi<ClusterDetail>(`/api/admin/risk/duplicates/${id}`);
  const { show } = useToast();
  const [dialog, setDialog] = useState<null | "fp" | "confirm" | "merge">(null);
  const [note, setNote] = useState("");
  const [fp, setFp] = useState("SHARED_FAMILY_PHONE");
  const [plan, setPlan] = useState<MergePlan["plan"] | null>(null);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;
  const closed = ["FALSE_POSITIVE", "RESOLVED", "SUPERSEDED"].includes(data.cluster.status);

  async function resolve(body: Record<string, unknown>) {
    const r = await callApi<{ approvalRequired?: boolean; approvalCode?: string }>(`/api/admin/risk/duplicates/${id}/resolve`, "POST", body);
    if (!r.ok) { show(r.data.error ?? "Could not save", "error"); return; }
    if (r.data.approvalRequired) show(`Approval requested (${r.data.approvalCode}). Nothing has changed yet.`, "info");
    else show("Saved", "success");
    setDialog(null); setNote("");
    onChanged();
  }
  async function planMerge() {
    const r = await callApi<MergePlan>(`/api/admin/risk/duplicates/${id}/merge-plan`, "POST", { reason: note });
    if (!r.ok) { show(r.data.error ?? "Could not plan the merge", "error"); return; }
    setPlan(r.data.plan); setDialog(null); setNote("");
  }

  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      <p className="rounded-lg border border-info/30 bg-info/5 p-2 text-xs text-muted">Shared family phones, devices and homes are common. Compare the accounts before deciding, and consider whether they are relatives.</p>
      <div className="grid gap-3 md:grid-cols-2">
        {data.members.map((m) => (
          <div key={m.profileId} className="rounded-lg border border-border p-3 text-sm">
            <dl>
              <KV label="Profile"><Link className="text-primary hover:underline" href={`/admin/profiles/${m.profileId}`}>{m.profileCode}</Link></KV>
              {m.fullName && <KV label="Name">{m.fullName}</KV>}
              <KV label="Status"><StatusBadge status={m.status} /></KV>
              <KV label="Verified">{m.verified ? "Yes" : "No"}</KV>
              {m.city && <KV label="Location">{m.city}, {m.country}</KV>}
              <KV label="Registered">{formatDateTime(m.registeredAt)}</KV>
              <KV label="Relationships"><Link className="text-primary hover:underline" href={`/admin/risk-center/relationships/${m.profileId}`}>Graph</Link></KV>
            </dl>
          </div>
        ))}
      </div>
      {data.candidates.length > 0 && (
        <div className="text-xs text-muted">
          {data.candidates.map((c) => <p key={c.candidateCode}>{c.candidateCode}: matched on {c.matchingSignals.map(formatEnumLabel).join(", ")} ({formatEnumLabel(c.confidenceBand)}) — {formatEnumLabel(c.status)}</p>)}
        </div>
      )}
      {!closed && (
        <div className="flex flex-wrap gap-2">
          {can("duplicates:resolve") && <Button size="sm" variant="outline" onClick={() => setDialog("fp")}>Not duplicates / related family…</Button>}
          {can("duplicates:resolve") && data.cluster.status !== "CONFIRMED" && <Button size="sm" variant="outline" onClick={() => setDialog("confirm")}>Confirm duplicate (approval needed)…</Button>}
          {can("duplicates:merge") && data.cluster.status === "CONFIRMED" && <Button size="sm" variant="outline" onClick={() => setDialog("merge")}>Plan merge…</Button>}
        </div>
      )}
      {plan && (
        <Card title="Merge plan (planning only — nothing has been merged)">
          {plan.blockedReason && <p className="mb-2 rounded bg-danger/10 p-2 text-sm text-danger">{plan.blockedReason}</p>}
          <p className="text-sm">Suggested surviving account: <span className="font-mono text-xs">{plan.suggestedSurvivorId}</span> (a suggestion — a reviewer decides).</p>
          {plan.approval && <p className="text-sm">Approval request: {plan.approval.approvalCode} ({formatEnumLabel(plan.approval.status)})</p>}
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted">{plan.preservationChecklist.map((p) => <li key={p}>{p}</li>)}</ul>
        </Card>
      )}

      <ConfirmDialog open={dialog === "fp"} title="Not duplicates" description="Records why, so these accounts are not flagged together again." confirmLabel="Save" confirmDisabled={note.trim().length < 5} onCancel={() => setDialog(null)} onConfirm={() => resolve({ decision: "FALSE_POSITIVE", note, falsePositiveReason: fp })}>
        <Field label="Reason"><Select value={fp} onChange={(e) => setFp(e.target.value)}>{FALSE_POSITIVE_CHOICES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></Field>
        <Field label="Note"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </ConfirmDialog>
      <ConfirmDialog open={dialog === "confirm"} title="Confirm duplicate" description="Goes through the duplicate-confirmation approval. Nothing is merged or deleted." confirmLabel="Request confirmation" confirmDisabled={note.trim().length < 5} onCancel={() => setDialog(null)} onConfirm={() => resolve({ decision: "CONFIRMED", note })}>
        <Field label="Why do you believe these are one person?"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </ConfirmDialog>
      <ConfirmDialog open={dialog === "merge"} title="Plan a merge" description="Produces a survivor suggestion and a preservation checklist and requests approval. It never merges any data." confirmLabel="Create plan" confirmDisabled={note.trim().length < 5} onCancel={() => setDialog(null)} onConfirm={planMerge}>
        <Field label="Reason"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </ConfirmDialog>
    </div>
  );
}
