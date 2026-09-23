"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, CheckCircle2, RotateCcw, Ban, ArrowUpCircle, UserCog, Send } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { formatDateTime, formatEnumLabel } from "@/lib/utils";
import type { Permission } from "@/lib/permissions";

interface TaskDetail {
  id: string;
  taskCode: string | null;
  taskType: string;
  title: string | null;
  description: string | null;
  resourceType: string;
  resourceId: string;
  priority: string;
  status: string;
  dueAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  completionNotes: string | null;
  outcome: string | null;
  escalationLevel: number;
  escalationStatus: string;
  version: number;
  accessLevel: string;
  assignedTo: { id: string; name: string } | null;
  assignedDepartment: { id: string; name: string } | null;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
  checklistItems: { id: string; label: string; required: boolean; completedAt: string | null }[];
  statusHistory: { id: string; previousStatus: string; newStatus: string; reason: string | null; createdAt: string }[];
  escalations: { id: string; previousLevel: number; newLevel: number; reason: string; createdAt: string }[];
  comments: { id: string; body: string; visibility: string; createdAt: string; author: { id: string; name: string } }[];
}

const RESOURCE_LINK: Record<string, (id: string) => string> = {
  PROFILE: (id) => `/admin/profiles/${id}`,
  PROPOSAL: (id) => `/admin/proposals/${id}`,
  CASE: (id) => `/admin/case-management/${id}`,
};

export default function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { show } = useToast();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [busy, setBusy] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassignTo, setReassignTo] = useState("");
  const [reassignReason, setReassignReason] = useState("");
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [escalateReason, setEscalateReason] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([]);

  function load() {
    fetch(`/api/admin/tasks/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then(setTask)
      .catch(() => setNotFound(true));
  }

  useEffect(() => {
    load();
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((s) => setPermissions(s?.user?.permissions ?? []))
      .catch(() => {});
    fetch("/api/admin/admin-users")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data) => setStaff((data.items ?? []).filter((a: { active?: boolean }) => a.active !== false)))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function callAction(path: string, body: Record<string, unknown> = {}, successMessage = "Done") {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/tasks/${id}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) {
        show(json.error ?? "Something went wrong.", "error");
        return;
      }
      show(successMessage, "success");
      load();
    } finally {
      setBusy(false);
    }
  }

  async function postComment() {
    if (!commentBody.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/tasks/${id}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: commentBody }) });
      const json = await res.json();
      if (!res.ok) {
        show(json.error ?? "Could not add comment.", "error");
        return;
      }
      setCommentBody("");
      load();
    } finally {
      setBusy(false);
    }
  }

  if (notFound) return <div className="p-6 text-sm text-muted">Task not found, or you do not have access to it.</div>;
  if (!task) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  const resourceLink = RESOURCE_LINK[task.resourceType]?.(task.resourceId);
  const canAccept = permissions.includes("tasks:accept") && task.status === "ASSIGNED";
  const canComplete = permissions.includes("tasks:complete") && !["COMPLETED", "CANCELLED", "ARCHIVED"].includes(task.status);
  const canReopen = permissions.includes("tasks:reopen") && ["COMPLETED", "CANCELLED", "EXPIRED"].includes(task.status);
  const canCancel = permissions.includes("tasks:cancel") && !["CANCELLED", "ARCHIVED", "COMPLETED"].includes(task.status);
  const canReassign = permissions.includes("tasks:reassign") && !!task.assignedTo;
  const canEscalate = permissions.includes("tasks:escalate") && task.escalationLevel < 4;

  return (
    <div className="space-y-4">
      <Link href="/admin/workflow" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Workflow &amp; Tasks
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">{task.title ?? formatEnumLabel(task.taskType)}</h1>
          <p className="font-mono text-xs text-muted">{task.taskCode ?? task.id}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="muted">{formatEnumLabel(task.priority)}</Badge>
          <Badge variant={task.status === "ESCALATED" ? "danger" : "info"}>{formatEnumLabel(task.status)}</Badge>
          {task.escalationLevel > 1 && <Badge variant="danger">Escalation L{task.escalationLevel}</Badge>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Task Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {task.description && <p className="text-muted">{task.description}</p>}
              <div className="grid grid-cols-2 gap-2 text-xs text-muted">
                <div>Created: {formatDateTime(task.createdAt)}</div>
                <div>Due: {task.dueAt ? formatDateTime(task.dueAt) : "—"}</div>
                <div>Started: {task.startedAt ? formatDateTime(task.startedAt) : "—"}</div>
                <div>Completed: {task.completedAt ? formatDateTime(task.completedAt) : "—"}</div>
              </div>
              {task.outcome && <p><span className="font-medium">Outcome:</span> {task.outcome}</p>}
              {task.completionNotes && <p><span className="font-medium">Completion notes:</span> {task.completionNotes}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Source Record</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <p className="text-muted">
                {formatEnumLabel(task.resourceType)} — <span className="font-mono text-xs">{task.resourceId}</span>
              </p>
              {resourceLink && (
                <Link href={resourceLink} className="mt-1 inline-block font-medium text-primary hover:underline">
                  Open source record
                </Link>
              )}
            </CardContent>
          </Card>

          {task.checklistItems.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Checklist</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                {task.checklistItems.map((item) => (
                  <div key={item.id} className="flex items-center gap-2">
                    <CheckCircle2 className={`h-4 w-4 ${item.completedAt ? "text-success" : "text-muted"}`} />
                    <span className={item.completedAt ? "line-through text-muted" : ""}>{item.label}</span>
                    {item.required && !item.completedAt && <Badge variant="warning">Required</Badge>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Timeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {task.escalations.map((e) => (
                <div key={e.id} className="border-l-2 border-danger pl-3 text-xs">
                  <p className="font-medium text-danger">Escalated L{e.previousLevel} → L{e.newLevel}</p>
                  <p className="text-muted">{e.reason}</p>
                  <p className="text-muted">{formatDateTime(e.createdAt)}</p>
                </div>
              ))}
              {task.statusHistory.map((h) => (
                <div key={h.id} className="border-l-2 border-border pl-3 text-xs">
                  <p className="font-medium">{formatEnumLabel(h.previousStatus)} → {formatEnumLabel(h.newStatus)}</p>
                  {h.reason && <p className="text-muted">{h.reason}</p>}
                  <p className="text-muted">{formatDateTime(h.createdAt)}</p>
                </div>
              ))}
              {task.statusHistory.length === 0 && task.escalations.length === 0 && <p className="text-muted">No history yet.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Comments</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {task.comments.map((c) => (
                <div key={c.id} className="rounded-lg bg-surface-muted p-2.5">
                  <p className="flex items-center justify-between text-xs text-muted">
                    <span className="font-medium text-foreground">{c.author.name}</span>
                    <span>{formatDateTime(c.createdAt)}</span>
                  </p>
                  <p className="mt-1">{c.body}</p>
                </div>
              ))}
              {permissions.includes("tasks:comment") && (
                <div className="space-y-2">
                  <Textarea rows={2} placeholder="Add an internal comment…" value={commentBody} onChange={(e) => setCommentBody(e.target.value)} />
                  <Button size="sm" onClick={postComment} disabled={busy || !commentBody.trim()}>
                    <Send className="h-3.5 w-3.5" /> Post Comment
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Assignment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <p><span className="text-muted">Assigned to:</span> {task.assignedTo?.name ?? "Unassigned"}</p>
              <p><span className="text-muted">Department:</span> {task.assignedDepartment?.name ?? "—"}</p>
              <p><span className="text-muted">Created by:</span> {task.createdBy?.name ?? "System"}</p>
              <p><span className="text-muted">Your access:</span> {formatEnumLabel(task.accessLevel)}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Actions</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {canAccept && (
                <Button size="sm" onClick={() => callAction("/assign", { adminId: task.assignedTo?.id })} disabled={busy}>
                  Accept Task
                </Button>
              )}
              {canComplete && (
                <Button size="sm" onClick={() => callAction("/complete", {}, "Task completed")} disabled={busy}>
                  <CheckCircle2 className="h-3.5 w-3.5" /> Complete
                </Button>
              )}
              {canReassign && (
                <Button size="sm" variant="outline" onClick={() => setReassignOpen(true)} disabled={busy}>
                  <UserCog className="h-3.5 w-3.5" /> Reassign
                </Button>
              )}
              {canEscalate && (
                <Button size="sm" variant="outline" onClick={() => setEscalateOpen(true)} disabled={busy}>
                  <ArrowUpCircle className="h-3.5 w-3.5" /> Escalate
                </Button>
              )}
              {canReopen && (
                <Button size="sm" variant="outline" onClick={() => callAction("/reopen", { reason: "Reopened for further review" }, "Task reopened")} disabled={busy}>
                  <RotateCcw className="h-3.5 w-3.5" /> Reopen
                </Button>
              )}
              {canCancel && (
                <Button size="sm" variant="outline" onClick={() => setCancelOpen(true)} disabled={busy}>
                  <Ban className="h-3.5 w-3.5" /> Cancel
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={reassignOpen}
        title="Reassign Task"
        description="Requires a reason — both the previous and new owner will be notified."
        confirmLabel="Reassign"
        confirmDisabled={busy || !reassignTo || reassignReason.trim().length < 5}
        onConfirm={() => { callAction("/reassign", { newAdminId: reassignTo, reason: reassignReason }, "Task reassigned"); setReassignOpen(false); }}
        onCancel={() => setReassignOpen(false)}
      >
        <Field label="Reassign to" htmlFor="reassignTo">
          <Select id="reassignTo" value={reassignTo} onChange={(e) => setReassignTo(e.target.value)}>
            <option value="">Select a staff member…</option>
            {staff.filter((s) => s.id !== task.assignedTo?.id).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Reason" htmlFor="reassignReason">
          <Input id="reassignReason" value={reassignReason} onChange={(e) => setReassignReason(e.target.value)} />
        </Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={escalateOpen}
        title="Escalate Task"
        description="Escalation means this task requires higher-level review — it is never an automatic adverse decision."
        confirmLabel="Escalate"
        danger
        confirmDisabled={busy || !escalateReason.trim()}
        onConfirm={() => { callAction("/escalate", { reason: escalateReason }, "Task escalated"); setEscalateOpen(false); }}
        onCancel={() => setEscalateOpen(false)}
      >
        <Field label="Reason" htmlFor="escalateReason">
          <Input id="escalateReason" value={escalateReason} onChange={(e) => setEscalateReason(e.target.value)} />
        </Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={cancelOpen}
        title="Cancel Task"
        description="This task will be marked cancelled. Provide a reason for the audit trail."
        confirmLabel="Cancel Task"
        danger
        confirmDisabled={busy || cancelReason.trim().length < 5}
        onConfirm={() => { callAction("/cancel", { reason: cancelReason }, "Task cancelled"); setCancelOpen(false); }}
        onCancel={() => setCancelOpen(false)}
      >
        <Field label="Reason" htmlFor="cancelReason">
          <Input id="cancelReason" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
        </Field>
      </ConfirmDialog>
    </div>
  );
}
