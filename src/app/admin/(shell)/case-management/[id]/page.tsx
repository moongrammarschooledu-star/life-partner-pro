"use client";

import { useEffect, useState, use, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Send, Paperclip, UserPlus, ArrowUpCircle, CheckCircle2, RotateCcw, MessageSquareWarning } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonClass } from "@/components/ui/button";
import { Field, Textarea, Select, Input } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Timeline, type TimelineItem } from "@/components/ui/timeline";
import { useToast } from "@/components/ui/toast";
import { formatDateTime, formatEnumLabel } from "@/lib/utils";

interface CaseDetail {
  id: string;
  caseNumber: string;
  type: string;
  category: string;
  subject: string;
  description: string;
  priority: string;
  status: string;
  escalationLevel: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  accessLevel: "NONE" | "VIEW" | "COMMENT" | "EDIT" | "MANAGE";
  assignedTo: { id: string; name: string } | null;
  reporterProfile: { id: string; fullName: string; profileCode: string; city: string } | null;
  reportedProfile: { id: string; fullName: string; profileCode: string } | null;
  reportedAdmin: { id: string; name: string } | null;
  comments: { id: string; body: string; visibleToUser: boolean; createdAt: string; authorAdmin: { name: string } | null; authorProfile: { fullName: string } | null }[];
  statusHistory: { id: string; fromStatus: string | null; toStatus: string; createdAt: string; changedBy: { name: string } | null; reason: string | null }[];
  escalations: { id: string; previousLevel: number; newLevel: number; reason: string; createdAt: string; escalatedBy: { name: string } }[];
  resolution: { category: string; summary: string; actionTaken: string | null; createdAt: string; resolvedBy: { name: string } } | null;
  evidence: { id: string; mimeType: string; sizeBytes: number; originalFilename: string | null; createdAt: string }[];
}

interface Note {
  id: string;
  body: string;
  level: string;
  createdAt: string;
  editedAt: string | null;
  admin: { name: string };
}

const STATUS_OPTIONS = ["NEW", "ACKNOWLEDGED", "ASSIGNED", "IN_REVIEW", "WAITING_FOR_USER", "WAITING_FOR_STAFF", "ACTION_REQUIRED", "ARCHIVED"];
const RESOLUTION_CATEGORIES = [
  "INFORMATION_PROVIDED", "USER_ISSUE_RESOLVED", "PROFILE_CORRECTED", "VERIFICATION_REQUESTED",
  "CONTACT_RESTRICTION_APPLIED", "PROFILE_RESTRICTED", "PROFILE_SUSPENDED", "CASE_ESCALATED",
  "NO_VIOLATION_CONFIRMED", "INSUFFICIENT_INFORMATION", "DUPLICATE_CASE", "OTHER_RESOLUTION",
];

export default function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { show } = useToast();
  const [data, setData] = useState<CaseDetail | null>(null);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [staffOptions, setStaffOptions] = useState<{ id: string; name: string }[]>([]);

  const [commentBody, setCommentBody] = useState("");
  const [commentInternal, setCommentInternal] = useState(false);
  const [noteBody, setNoteBody] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [conflictWarnings, setConflictWarnings] = useState<string[] | null>(null);

  const [escalateOpen, setEscalateOpen] = useState(false);
  const [escalateReason, setEscalateReason] = useState("");
  const [requestInfoOpen, setRequestInfoOpen] = useState(false);
  const [requestInfoMessage, setRequestInfoMessage] = useState("");
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolutionCategory, setResolutionCategory] = useState(RESOLUTION_CATEGORIES[0]);
  const [resolutionSummary, setResolutionSummary] = useState("");
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/admin/cases/${id}`).then((r) => r.json()).then(setData);
    fetch(`/api/admin/cases/${id}/notes`).then((r) => r.json()).then((j) => setNotes(j.items ?? []));
  }, [id]);

  useEffect(() => {
    load();
    fetch("/api/admin/reports/admins").then((r) => r.json()).then((j) => setStaffOptions(j.items ?? [])).catch(() => {});
  }, [load]);

  async function postJSON(url: string, body: unknown) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? "Something went wrong.");
    return json;
  }

  async function assign(confirmOverrideConflict = false) {
    if (!assignTo) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/cases/${id}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedToId: assignTo, confirmOverrideConflict }),
      });
      if (res.status === 409) {
        const json = await res.json();
        setConflictWarnings(json.conflictWarnings ?? []);
        return;
      }
      if (!res.ok) throw new Error((await res.json()).error);
      setConflictWarnings(null);
      show("Case assigned", "success");
      load();
    } catch (e) {
      show(e instanceof Error ? e.message : "Could not assign case.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function addComment() {
    if (!commentBody.trim()) return;
    try {
      await postJSON(`/api/admin/cases/${id}/comments`, { body: commentBody, visibleToUser: !commentInternal });
      setCommentBody("");
      show("Message added", "success");
      load();
    } catch (e) {
      show(e instanceof Error ? e.message : "Could not add message.", "error");
    }
  }

  async function addNote() {
    if (!noteBody.trim()) return;
    try {
      await postJSON(`/api/admin/cases/${id}/notes`, { body: noteBody });
      setNoteBody("");
      show("Note added", "success");
      load();
    } catch (e) {
      show(e instanceof Error ? e.message : "Could not add note.", "error");
    }
  }

  async function changeStatus(status: string) {
    try {
      await postJSON(`/api/admin/cases/${id}/status`, { status });
      show("Status updated", "success");
      load();
    } catch (e) {
      show(e instanceof Error ? e.message : "Could not update status.", "error");
    }
  }

  async function escalate() {
    try {
      await postJSON(`/api/admin/cases/${id}/escalate`, { reason: escalateReason });
      setEscalateOpen(false);
      setEscalateReason("");
      show("Case escalated", "success");
      load();
    } catch (e) {
      show(e instanceof Error ? e.message : "Could not escalate case.", "error");
    }
  }

  async function requestInfo() {
    try {
      await postJSON(`/api/admin/cases/${id}/request-info`, { message: requestInfoMessage });
      setRequestInfoOpen(false);
      setRequestInfoMessage("");
      show("Information requested", "success");
      load();
    } catch (e) {
      show(e instanceof Error ? e.message : "Could not request information.", "error");
    }
  }

  async function resolve() {
    try {
      await postJSON(`/api/admin/cases/${id}/resolve`, { category: resolutionCategory, summary: resolutionSummary });
      setResolveOpen(false);
      setResolutionSummary("");
      show("Case resolved", "success");
      load();
    } catch (e) {
      show(e instanceof Error ? e.message : "Could not resolve case.", "error");
    }
  }

  async function closeCase() {
    try {
      await postJSON(`/api/admin/cases/${id}/close`, {});
      show("Case closed", "success");
      load();
    } catch (e) {
      show(e instanceof Error ? e.message : "Could not close case.", "error");
    }
  }

  async function reopen() {
    try {
      await postJSON(`/api/admin/cases/${id}/reopen`, { reason: reopenReason });
      setReopenOpen(false);
      setReopenReason("");
      show("Case reopened", "success");
      load();
    } catch (e) {
      show(e instanceof Error ? e.message : "Could not reopen case.", "error");
    }
  }

  if (!data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  const canEdit = data.accessLevel === "EDIT" || data.accessLevel === "MANAGE";
  const canComment = canEdit || data.accessLevel === "COMMENT";

  const timelineItems: TimelineItem[] = [
    { id: "created", label: "Case created", date: data.createdAt },
    ...data.statusHistory.map((h) => ({
      id: h.id,
      label: `${formatEnumLabel(h.fromStatus ?? "—")} → ${formatEnumLabel(h.toStatus)}`,
      description: [h.changedBy?.name, h.reason].filter(Boolean).join(" — ") || undefined,
      date: h.createdAt,
    })),
    ...data.escalations.map((e) => ({
      id: e.id,
      label: `Escalated to Level ${e.newLevel}`,
      description: `${e.escalatedBy.name} — ${e.reason}`,
      date: e.createdAt,
    })),
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return (
    <div className="space-y-4">
      <Link href="/admin/case-management" className={buttonClass({ variant: "outline", size: "sm" })}>
        <ArrowLeft className="h-4 w-4" /> Back to Case Management
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">{data.caseNumber}</h1>
          <p className="text-sm text-muted">{formatEnumLabel(data.type)} · {formatEnumLabel(data.category)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={data.status} />
          <Badge variant={data.priority === "CRITICAL" || data.priority === "URGENT" ? "danger" : data.priority === "HIGH" ? "warning" : "muted"}>{formatEnumLabel(data.priority)}</Badge>
          {data.escalationLevel > 1 && <Badge variant="danger">Escalation Level {data.escalationLevel}</Badge>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle className="text-base">{data.subject}</CardTitle></CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm">{data.description}</p>
            </CardContent>
          </Card>

          {data.resolution && (
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-success" /> Resolution</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p><span className="text-muted">Category:</span> {formatEnumLabel(data.resolution.category)}</p>
                <p>{data.resolution.summary}</p>
                {data.resolution.actionTaken && <p><span className="text-muted">Action taken:</span> {data.resolution.actionTaken}</p>}
                <p className="text-xs text-muted">By {data.resolution.resolvedBy.name} · {formatDateTime(data.resolution.createdAt)}</p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle className="text-base">Communication</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {data.comments.length === 0 ? (
                <p className="text-sm text-muted">No messages yet.</p>
              ) : (
                data.comments.map((c) => (
                  <div key={c.id} className={`rounded-lg border p-3 text-sm ${c.visibleToUser ? "border-border" : "border-warning/40 bg-warning/5"}`}>
                    <p>{c.body}</p>
                    <p className="mt-1 text-xs text-muted">
                      {c.authorAdmin?.name ?? c.authorProfile?.fullName ?? "Unknown"} · {formatDateTime(c.createdAt)}
                      {!c.visibleToUser && " · Internal only"}
                    </p>
                  </div>
                ))
              )}
              {canComment && (
                <div className="space-y-2 border-t border-border pt-3">
                  <Textarea placeholder="Write a message…" value={commentBody} onChange={(e) => setCommentBody(e.target.value)} className="min-h-16" />
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-1.5 text-xs text-muted">
                      <input type="checkbox" checked={commentInternal} onChange={(e) => setCommentInternal(e.target.checked)} /> Internal only (not visible to user)
                    </label>
                    <Button size="sm" onClick={addComment} disabled={!commentBody.trim()}>
                      <Send className="h-3.5 w-3.5" /> Send
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><MessageSquareWarning className="h-4 w-4" /> Internal Investigation Notes</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {notes === null ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted" />
              ) : notes.length === 0 ? (
                <p className="text-sm text-muted">No internal notes yet.</p>
              ) : (
                notes.map((n) => (
                  <div key={n.id} className="rounded-lg border border-border p-3 text-sm">
                    <p>{n.body}</p>
                    <p className="mt-1 text-xs text-muted">{n.admin.name} · {formatEnumLabel(n.level)} · {formatDateTime(n.createdAt)}{n.editedAt && " (edited)"}</p>
                  </div>
                ))
              )}
              {canComment && (
                <div className="space-y-2 border-t border-border pt-3">
                  <Textarea placeholder="Add an investigation note (staff-only)…" value={noteBody} onChange={(e) => setNoteBody(e.target.value)} className="min-h-16" />
                  <Button size="sm" onClick={addNote} disabled={!noteBody.trim()}>Add Note</Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Paperclip className="h-4 w-4" /> Evidence</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {data.evidence.length === 0 ? (
                <p className="text-sm text-muted">No evidence attached.</p>
              ) : (
                data.evidence.map((e) => (
                  <a key={e.id} href={`/api/admin/case-evidence/${e.id}`} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-lg border border-border p-2.5 text-sm hover:bg-surface-muted">
                    <span>{e.originalFilename ?? "Attachment"}</span>
                    <span className="text-xs text-muted">{(e.sizeBytes / 1024).toFixed(0)} KB · {formatDateTime(e.createdAt)}</span>
                  </a>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Timeline</CardTitle></CardHeader>
            <CardContent>
              <Timeline items={timelineItems} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Reporter</CardTitle></CardHeader>
            <CardContent className="text-sm">
              {data.reporterProfile ? (
                <Link href={`/admin/profiles/${data.reporterProfile.id}`} className="text-primary hover:underline">
                  {data.reporterProfile.fullName} ({data.reporterProfile.profileCode})
                </Link>
              ) : (
                <p className="text-muted">Internal case — no external reporter.</p>
              )}
            </CardContent>
          </Card>

          {(data.reportedProfile || data.reportedAdmin) && (
            <Card>
              <CardHeader><CardTitle className="text-base">Reported</CardTitle></CardHeader>
              <CardContent className="text-sm">
                {data.reportedProfile && (
                  <Link href={`/admin/profiles/${data.reportedProfile.id}`} className="text-primary hover:underline">
                    {data.reportedProfile.fullName} ({data.reportedProfile.profileCode})
                  </Link>
                )}
                {data.reportedAdmin && <p className="text-warning">Staff conduct: {data.reportedAdmin.name}</p>}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><UserPlus className="h-4 w-4" /> Assignment</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm">Currently: <span className="font-medium">{data.assignedTo?.name ?? "Unassigned"}</span></p>
              <Select value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
                <option value="">Select staff…</option>
                {staffOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
              {conflictWarnings && conflictWarnings.length > 0 && (
                <div className="rounded-lg border border-warning/40 bg-warning/5 p-2 text-xs text-warning">
                  {conflictWarnings.map((w, i) => <p key={i}>{w}</p>)}
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => assign(true)}>Assign Anyway</Button>
                </div>
              )}
              <Button size="sm" onClick={() => assign(false)} disabled={!assignTo || busy}>Assign</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Actions</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {canEdit && (
                <Field label="Change Status" htmlFor="statusSelect">
                  <Select id="statusSelect" value={data.status} onChange={(e) => changeStatus(e.target.value)}>
                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{formatEnumLabel(s)}</option>)}
                  </Select>
                </Field>
              )}
              {canEdit && data.status !== "RESOLVED" && data.status !== "CLOSED" && (
                <>
                  <Button size="sm" variant="outline" className="w-full" onClick={() => setRequestInfoOpen(true)}>Request More Information</Button>
                  <Button size="sm" variant="outline" className="w-full" onClick={() => setEscalateOpen(true)}>
                    <ArrowUpCircle className="h-3.5 w-3.5" /> Escalate
                  </Button>
                  <Button size="sm" className="w-full" onClick={() => setResolveOpen(true)}>Resolve</Button>
                </>
              )}
              {canEdit && data.status === "RESOLVED" && (
                <Button size="sm" className="w-full" onClick={closeCase}>
                  <CheckCircle2 className="h-3.5 w-3.5" /> Close Case
                </Button>
              )}
              {canEdit && (data.status === "RESOLVED" || data.status === "CLOSED") && (
                <Button size="sm" variant="outline" className="w-full" onClick={() => setReopenOpen(true)}>
                  <RotateCcw className="h-3.5 w-3.5" /> Reopen
                </Button>
              )}
              {!canEdit && <p className="text-xs text-muted">You have view-only access to this case.</p>}
            </CardContent>
          </Card>
        </div>
      </div>

      <ConfirmDialog open={escalateOpen} title="Escalate Case" description="This raises the case to the next escalation level and notifies the appropriate reviewer." confirmLabel="Escalate" onConfirm={escalate} onCancel={() => setEscalateOpen(false)} confirmDisabled={!escalateReason.trim()}>
        <Field label="Reason" htmlFor="escalateReason"><Textarea id="escalateReason" value={escalateReason} onChange={(e) => setEscalateReason(e.target.value)} /></Field>
      </ConfirmDialog>

      <ConfirmDialog open={requestInfoOpen} title="Request More Information" description="The user will be notified and asked to provide additional details before the case can proceed." confirmLabel="Send Request" onConfirm={requestInfo} onCancel={() => setRequestInfoOpen(false)} confirmDisabled={!requestInfoMessage.trim()}>
        <Field label="What do you need from them?" htmlFor="requestInfoMessage"><Textarea id="requestInfoMessage" value={requestInfoMessage} onChange={(e) => setRequestInfoMessage(e.target.value)} /></Field>
      </ConfirmDialog>

      <ConfirmDialog open={resolveOpen} title="Resolve Case" description="This records the outcome and notifies the reporting user." confirmLabel="Resolve" onConfirm={resolve} onCancel={() => setResolveOpen(false)} confirmDisabled={!resolutionSummary.trim()}>
        <Field label="Resolution Category" htmlFor="resolutionCategory">
          <Select id="resolutionCategory" value={resolutionCategory} onChange={(e) => setResolutionCategory(e.target.value)}>
            {RESOLUTION_CATEGORIES.map((c) => <option key={c} value={c}>{formatEnumLabel(c)}</option>)}
          </Select>
        </Field>
        <Field label="Summary" htmlFor="resolutionSummary"><Textarea id="resolutionSummary" value={resolutionSummary} onChange={(e) => setResolutionSummary(e.target.value)} /></Field>
      </ConfirmDialog>

      <ConfirmDialog open={reopenOpen} title="Reopen Case" description="This returns the case to the active queue for further review." confirmLabel="Reopen" onConfirm={reopen} onCancel={() => setReopenOpen(false)} confirmDisabled={!reopenReason.trim()}>
        <Field label="Reason" htmlFor="reopenReason"><Input id="reopenReason" value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} /></Field>
      </ConfirmDialog>
    </div>
  );
}
