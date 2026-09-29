"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Select, Textarea } from "@/components/ui/form";
import { Tabs } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { Card, ErrorNote, Loading, StatusBadge, callApi, timeAgo, useApi } from "@/components/admin/system/shared";
import { formatEnumLabel } from "@/lib/utils";

// Admin -> Documents. A shell over the STEP 26 APIs: every call enforces its own permission on the
// server. Never shows file content inline here — preview/download go through their own authenticated,
// permission-checked, audited routes.

interface DocRow { id: string; documentCode: string; typeKey: string; categoryKey: string; classification: string; status: string; verificationStatus: string; originalFilename: string; sizeBytes: number; currentVersion: number; expiresAt: string | null; createdAt: string }

export function DocumentsClient({ permissions }: { permissions: string[] }) {
  const can = (p: string) => permissions.includes(p);
  const tabs = [
    { value: "all", label: "All", show: can("documents:view") },
    { value: "pending", label: "Pending Review", show: can("documents:review") },
    { value: "verification", label: "Verification", show: can("documents:verify") },
    { value: "rejected", label: "Rejected", show: can("documents:view") },
    { value: "expiring", label: "Expiring", show: can("documents:view") },
    { value: "restricted", label: "Restricted", show: can("documents:view") },
    { value: "quarantined", label: "Quarantined", show: can("documents:manage_providers") },
    { value: "archived", label: "Archived", show: can("documents:view") },
    { value: "audit", label: "Audit", show: can("documents:audit:view") },
  ].filter((t) => t.show);
  const [tab, setTab] = useState(tabs[0]?.value ?? "all");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Documents</h1>
          <p className="text-sm text-muted">Uploaded, verified, shared and signed documents — private by default. No preview or download bypasses its own permission check.</p>
        </div>
        <Link href="/admin/document-requests" className="text-sm text-primary hover:underline">Document requests</Link>
      </div>
      <Tabs tabs={tabs.map(({ value, label }) => ({ value, label }))} value={tab} onChange={setTab} />
      {tab === "all" && <ListTab filter={{}} canReview={can("documents:review")} />}
      {tab === "pending" && <ListTab filter={{ status: "AVAILABLE" }} canReview={can("documents:review")} />}
      {tab === "verification" && <ListTab filter={{ verificationStatus: "UNDER_REVIEW" }} canReview={can("documents:review")} />}
      {tab === "rejected" && <ListTab filter={{ status: "REJECTED" }} canReview={can("documents:review")} />}
      {tab === "expiring" && <ExpiringTab />}
      {tab === "restricted" && <ListTab filter={{ status: "RESTRICTED" }} canReview={can("documents:review")} />}
      {tab === "quarantined" && <QuarantineTab />}
      {tab === "archived" && <ListTab filter={{ includeArchived: "true", status: "ARCHIVED" }} canReview={can("documents:review")} />}
      {tab === "audit" && <AuditTab />}
    </div>
  );
}

function DocRowItem({ d }: { d: DocRow }) {
  return (
    <Link href={`/admin/documents/${d.id}`} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm hover:bg-surface-muted">
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs">{d.documentCode}</span>
        <Badge>{formatEnumLabel(d.typeKey)}</Badge>
        <StatusBadge status={d.status} />
        {d.verificationStatus !== "NOT_SUBMITTED" && <Badge variant={d.verificationStatus === "VERIFIED" ? "success" : d.verificationStatus === "REJECTED" ? "danger" : "warning"}>{formatEnumLabel(d.verificationStatus)}</Badge>}
        <Badge variant={["HIGHLY_SENSITIVE", "RESTRICTED"].includes(d.classification) ? "danger" : "default"}>{formatEnumLabel(d.classification)}</Badge>
      </span>
      <span className="text-xs text-muted">{timeAgo(d.createdAt)}</span>
    </Link>
  );
}

function ListTab({ filter, canReview }: { filter: Record<string, string>; canReview: boolean }) {
  const [profileId, setProfileId] = useState("");
  const qs = new URLSearchParams({ ...filter, ...(profileId ? { profileId } : {}) }).toString();
  const { data, error, loading } = useApi<{ items: DocRow[] }>(`/api/admin/documents?${qs}`);
  void canReview;
  return (
    <div className="space-y-3">
      <Input value={profileId} onChange={(e) => setProfileId(e.target.value.trim())} placeholder="Filter by profile id" className="w-72" />
      {loading && !data && <Loading />}
      {error && <ErrorNote message={error} />}
      {data && data.items.length === 0 && <EmptyState title="No documents" description="Nothing matches this filter." />}
      {data && data.items.length > 0 && <ul className="divide-y divide-border rounded-xl border border-border bg-surface">{data.items.map((d) => <li key={d.id}><DocRowItem d={d} /></li>)}</ul>}
    </div>
  );
}

function ExpiringTab() {
  const { data, error, loading } = useApi<{ items: DocRow[] }>("/api/admin/documents/expiring?withinDays=30");
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Documents expiring within 30 days. Reminders go out automatically at 30/14/7 days.</p>
      {loading && !data && <Loading />}
      {error && <ErrorNote message={error} />}
      {data && data.items.length === 0 && <EmptyState title="Nothing expiring soon" />}
      {data && data.items.length > 0 && <ul className="divide-y divide-border rounded-xl border border-border bg-surface">{data.items.map((d) => <li key={d.id}><DocRowItem d={d} /></li>)}</ul>}
    </div>
  );
}

function QuarantineTab() {
  const { data, error, loading, reload } = useApi<{ items: { id: string; documentId: string; reason: string; createdAt: string }[] }>("/api/admin/documents/quarantine");
  const { show } = useToast();
  async function decide(scanId: string, action: "release" | "destroy") {
    const note = window.prompt(action === "release" ? "Note (optional)" : "Reason for destroying this file (required)") ?? "";
    if (action === "destroy" && !note.trim()) return;
    const r = await callApi(`/api/admin/documents/quarantine/${scanId}/${action}`, "POST", { note });
    if (!r.ok) show((r.data as { error?: string }).error ?? "Could not update", "error");
    else { show(action === "release" ? "Released" : "Destroyed", "success"); reload(); }
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Files the security scanner flagged. Never accessible to a normal reviewer — only release or destroy, both audited.</p>
      {loading && !data && <Loading />}
      {error && <ErrorNote message={error} />}
      {data && data.items.length === 0 && <EmptyState title="Nothing in quarantine" />}
      {data && data.items.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {data.items.map((q) => (
            <li key={q.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <span>Document <Link href={`/admin/documents/${q.documentId}`} className="text-primary hover:underline">{q.documentId.slice(0, 8)}…</Link> — {q.reason} <span className="text-xs text-muted">({timeAgo(q.createdAt)})</span></span>
              <span className="flex gap-1"><Button size="sm" variant="secondary" onClick={() => decide(q.id, "release")}>Release</Button><Button size="sm" variant="danger" onClick={() => decide(q.id, "destroy")}>Destroy</Button></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AuditTab() {
  const [documentId, setDocumentId] = useState("");
  const { data, error, loading } = useApi<{ items: { id: string; documentId: string; action: string; actorType: string; actorId: string; result: string; denialReason: string | null; createdAt: string }[] }>(`/api/admin/documents/audit${documentId ? `?documentId=${documentId}` : ""}`);
  return (
    <div className="space-y-3">
      <Input value={documentId} onChange={(e) => setDocumentId(e.target.value.trim())} placeholder="Filter by document id" className="w-72" />
      {loading && !data && <Loading />}
      {error && <ErrorNote message={error} />}
      {data && data.items.length === 0 && <EmptyState title="No access events" />}
      {data && data.items.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface text-sm">
          {data.items.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <span><Badge variant={e.result === "ALLOWED" ? "default" : "danger"}>{formatEnumLabel(e.action)}</Badge> <span className="text-muted">{e.actorType.toLowerCase()} · {e.actorId.slice(0, 8)}…</span>{e.denialReason && <span className="text-xs text-danger"> ({formatEnumLabel(e.denialReason)})</span>}</span>
              <span className="text-xs text-muted">{timeAgo(e.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ document detail
export interface DocDetail extends DocRow { verificationReason: string | null; verificationNotes: string | null }

export function DocumentDetailClient({ id, permissions }: { id: string; permissions: string[] }) {
  const can = (p: string) => permissions.includes(p);
  const { data, error, loading, reload } = useApi<{ document: DocDetail; versions: { version: number; createdAt: string; changeReason: string | null; scanStatus: string }[]; history: { id: string; action: string; reasonKey: string | null; note: string | null; createdAt: string }[]; shares: { id: string; recipientType: string; recipientId: string; status: string; scope: string; expiresAt: string | null }[] }>(`/api/admin/documents/${id}`);
  const { show } = useToast();
  const [note, setNote] = useState("");
  const [reasonKey, setReasonKey] = useState("UNREADABLE");

  async function act(action: string, body: Record<string, unknown> = {}) {
    const r = await callApi<{ approvalRequired?: boolean; approvalCode?: string; error?: string }>(`/api/admin/documents/${id}/${action}`, "POST", { note, ...body });
    if (!r.ok) show(r.data.error ?? `Could not ${action}`, "error");
    else if (r.data.approvalRequired) show(`Sent for approval (${r.data.approvalCode})`, "success");
    else { show(`Document ${action.replace("-", " ")}`, "success"); setNote(""); reload(); }
  }

  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;
  const d = data.document;

  return (
    <div className="space-y-4">
      <Link href="/admin/documents" className="text-sm text-primary hover:underline">← All documents</Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">{d.documentCode}</h1>
        <StatusBadge status={d.status} />
        <Badge variant={["HIGHLY_SENSITIVE", "RESTRICTED"].includes(d.classification) ? "danger" : "default"}>{formatEnumLabel(d.classification)}</Badge>
      </div>
      <Card title="Metadata">
        <div className="grid gap-2 text-sm md:grid-cols-3">
          <div><span className="text-muted">Type:</span> {formatEnumLabel(d.typeKey)}</div>
          <div><span className="text-muted">Category:</span> {formatEnumLabel(d.categoryKey)}</div>
          <div><span className="text-muted">Version:</span> v{d.currentVersion ?? 1}</div>
          <div><span className="text-muted">File:</span> {d.originalFilename} ({Math.round(d.sizeBytes / 1024)} KB)</div>
          <div><span className="text-muted">Verification:</span> {formatEnumLabel(d.verificationStatus)}</div>
          <div><span className="text-muted">Expires:</span> {d.expiresAt ? new Date(d.expiresAt).toLocaleDateString() : "—"}</div>
        </div>
        {can("documents:view") && (
          <div className="mt-3 flex gap-2">
            <a className="text-sm text-primary hover:underline" href={`/api/admin/documents/${id}/preview`} target="_blank" rel="noreferrer">Preview</a>
            {can("documents:download") && <a className="text-sm text-primary hover:underline" href={`/api/admin/documents/${id}/download`}>Download</a>}
          </div>
        )}
      </Card>

      {can("documents:review") && !["VERIFIED", "REJECTED", "ARCHIVED", "DELETED"].includes(d.status) && (
        <Card title="Review">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional unless rejecting)" />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {can("documents:verify") && <Button size="sm" onClick={() => act("approve")}>Approve</Button>}
            {can("documents:reject") && (
              <>
                <Select value={reasonKey} onChange={(e) => setReasonKey(e.target.value)} className="w-56">
                  {["UNREADABLE", "INCOMPLETE", "EXPIRED", "MISMATCH", "UNSUPPORTED_DOCUMENT", "SECURITY_SCAN_FAILED", "INSUFFICIENT_INFORMATION", "VERIFICATION_FAILED", "OTHER"].map((r) => <option key={r} value={r}>{formatEnumLabel(r)}</option>)}
                </Select>
                <Button size="sm" variant="danger" onClick={() => act("reject", { reasonKey })}>Reject</Button>
              </>
            )}
            <Button size="sm" variant="secondary" onClick={() => act("request-info")}>Request more info</Button>
            <Button size="sm" variant="secondary" onClick={() => act("reverify")}>Mark re-verification required</Button>
            <Button size="sm" variant="secondary" onClick={() => act("restrict")}>Restrict</Button>
          </div>
        </Card>
      )}

      {d.status === "ARCHIVED" ? (
        can("documents:restore") && <Button size="sm" variant="secondary" onClick={() => act("restore")}>Restore</Button>
      ) : (
        can("documents:archive") && <Button size="sm" variant="secondary" onClick={() => act("archive")}>Archive</Button>
      )}

      <Card title="Shares">
        {data.shares.length === 0 ? <p className="text-sm text-muted">Not shared with anyone.</p> : (
          <ul className="space-y-1 text-sm">{data.shares.map((s) => <li key={s.id} className="flex items-center justify-between"><span><Badge>{formatEnumLabel(s.recipientType)}</Badge> {s.recipientId.slice(0, 8)}… <StatusBadge status={s.status} /> scope {s.scope.toLowerCase()}</span></li>)}</ul>
        )}
      </Card>

      <Card title="Versions">
        <ul className="space-y-1 text-sm">{data.versions.map((v) => <li key={v.version}>v{v.version} — {formatEnumLabel(v.scanStatus)} · {timeAgo(v.createdAt)}{v.changeReason ? ` — ${v.changeReason}` : ""}</li>)}</ul>
      </Card>

      <Card title="Review history">
        {data.history.length === 0 ? <p className="text-sm text-muted">No review decisions yet.</p> : (
          <ul className="space-y-1 text-sm">{data.history.map((h) => <li key={h.id}>{formatEnumLabel(h.action)}{h.reasonKey ? ` — ${formatEnumLabel(h.reasonKey)}` : ""} · {timeAgo(h.createdAt)}{h.note ? ` — ${h.note}` : ""}</li>)}</ul>
        )}
      </Card>
    </div>
  );
}
