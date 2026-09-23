"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, CheckCircle2, XCircle, RotateCcw, Ban, ArrowUpCircle, UserCog, Play } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { formatDateTime, formatEnumLabel } from "@/lib/utils";
import type { Permission } from "@/lib/permissions";

interface ApprovalDetail {
  id: string;
  approvalCode: string;
  actionType: string;
  status: string;
  riskLevel: string;
  priority: string;
  reason: string;
  sourceType: string;
  sourceId: string;
  currentStatePayload: unknown;
  requestedPayload: unknown;
  requiredLevel: string;
  currentLevel: string;
  requestedAt: string;
  expiresAt: string | null;
  completedAt: string | null;
  rejectedAt: string | null;
  executionStatus: string;
  version: number;
  maker: { id: string; name: string; role: string } | null;
  assignedChecker: { id: string; name: string } | null;
  assignedDepartment: { id: string; name: string } | null;
  createdTask: { id: string; taskCode: string | null; status: string } | null;
  steps: Array<{
    id: string;
    level: string;
    sequence: number;
    requiredRoles: string[];
    requiredCount: number;
    quorumCount: number;
    status: string;
    reviewers: Array<{ id: string; reviewerId: string; decision: string; decisionReason: string | null; decidedAt: string | null; reviewer: { id: string; name: string; role: string } }>;
  }>;
  catalogEntry: { label: string; domain: string } | null;
}

interface AuditEvent {
  id: string;
  eventType: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actor: { id: string; name: string } | null;
}

const RESOURCE_LINK: Record<string, (id: string) => string> = {
  PROFILE: (id) => `/admin/profiles/${id}`,
  PROPOSAL: (id) => `/admin/proposals/${id}`,
  CASE: (id) => `/admin/case-management/${id}`,
};

const STATUS_VARIANT: Record<string, "danger" | "warning" | "muted" | "success" | "info"> = {
  DRAFT: "muted", SUBMITTED: "info", PENDING_REVIEW: "info", PENDING_APPROVAL: "warning", PARTIALLY_APPROVED: "warning",
  APPROVED: "success", REJECTED: "danger", CHANGES_REQUESTED: "warning", EXPIRED: "danger", CANCELLED: "muted",
  EXECUTION_PENDING: "info", EXECUTING: "info", EXECUTED: "success", EXECUTION_FAILED: "danger", REOPENED: "warning", ARCHIVED: "muted",
};

const DECIDABLE_STATUSES = ["PENDING_REVIEW", "PENDING_APPROVAL", "PARTIALLY_APPROVED"];
const APPROVE_PERMISSIONS: Permission[] = ["approvals:approve", "finance:approval:approve", "privacy:approval:approve", "security:approval:approve", "ai:approval:approve", "sensitive:approval:approve"];
const EXECUTE_PERMISSIONS: Permission[] = ["approvals:execute", "finance:approval:execute", "privacy:approval:execute", "security:approval:execute", "ai:approval:execute", "sensitive:approval:execute"];

export default function ApprovalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { show } = useToast();
  const [approval, setApproval] = useState<ApprovalDetail | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [currentAdminId, setCurrentAdminId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([]);

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [changesOpen, setChangesOpen] = useState(false);
  const [changesReason, setChangesReason] = useState("");
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [escalateReason, setEscalateReason] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [delegateOpen, setDelegateOpen] = useState(false);
  const [delegateTo, setDelegateTo] = useState("");
  const [delegateReason, setDelegateReason] = useState("");

  function load() {
    fetch(`/api/admin/approvals/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then(setApproval)
      .catch(() => setNotFound(true));
    fetch(`/api/admin/approvals/${id}/audit`)
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((data) => setEvents(data.events ?? []))
      .catch(() => setEvents([]));
  }

  useEffect(() => {
    load();
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((s) => { setPermissions(s?.user?.permissions ?? []); setCurrentAdminId(s?.user?.id ?? null); })
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
      const res = await fetch(`/api/admin/approvals/${id}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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

  if (notFound) return <div className="p-6 text-sm text-muted">Approval request not found, or you do not have access to it.</div>;
  if (!approval) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  const resourceLink = RESOURCE_LINK[approval.sourceType]?.(approval.sourceId);
  const isMaker = approval.maker?.id === currentAdminId;
  const canDecide = !isMaker && DECIDABLE_STATUSES.includes(approval.status) && APPROVE_PERMISSIONS.some((p) => permissions.includes(p));
  const canEscalate = permissions.includes("approvals:escalate") && DECIDABLE_STATUSES.includes(approval.status);
  const canCancel = permissions.includes("approvals:cancel") && !["EXECUTED", "CANCELLED", "ARCHIVED"].includes(approval.status);
  const canExecute = approval.status === "APPROVED" && EXECUTE_PERMISSIONS.some((p) => permissions.includes(p));
  const canDelegate = canDecide && permissions.includes("approvals:delegate");

  return (
    <div className="space-y-4">
      <Link href="/admin/approvals" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Approvals
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">{approval.catalogEntry?.label ?? formatEnumLabel(approval.actionType)}</h1>
          <p className="font-mono text-xs text-muted">{approval.approvalCode}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="muted">{formatEnumLabel(approval.priority)}</Badge>
          <Badge variant={approval.riskLevel === "CRITICAL" ? "danger" : approval.riskLevel === "HIGH" ? "warning" : "info"}>{formatEnumLabel(approval.riskLevel)}</Badge>
          <Badge variant={STATUS_VARIANT[approval.status] ?? "muted"}>{formatEnumLabel(approval.status)}</Badge>
        </div>
      </div>

      {isMaker && DECIDABLE_STATUSES.includes(approval.status) && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          You created this request — as the maker, you cannot approve, reject, or execute it yourself (separation-of-duty).
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle className="text-base">Request Summary</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-muted">{approval.reason}</p>
              <div className="grid grid-cols-2 gap-2 text-xs text-muted">
                <div>Requested: {formatDateTime(approval.requestedAt)}</div>
                <div>Expires: {approval.expiresAt ? formatDateTime(approval.expiresAt) : "—"}</div>
                <div>Required level: {formatEnumLabel(approval.requiredLevel)}</div>
                <div>Current level: {formatEnumLabel(approval.currentLevel)}</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Source Record</CardTitle></CardHeader>
            <CardContent className="text-sm">
              <p className="text-muted">{formatEnumLabel(approval.sourceType)} — <span className="font-mono text-xs">{approval.sourceId}</span></p>
              {resourceLink && <Link href={resourceLink} className="mt-1 inline-block font-medium text-primary hover:underline">Open source record</Link>}
            </CardContent>
          </Card>

          {(approval.currentStatePayload != null || approval.requestedPayload != null) && (
            <Card>
              <CardHeader><CardTitle className="text-base">Before / After</CardTitle></CardHeader>
              <CardContent className="grid gap-3 text-xs sm:grid-cols-2">
                <div>
                  <p className="mb-1 font-medium text-muted">Current State</p>
                  <pre className="overflow-x-auto rounded-lg bg-surface-muted p-2">{JSON.stringify(approval.currentStatePayload ?? {}, null, 2)}</pre>
                </div>
                <div>
                  <p className="mb-1 font-medium text-muted">Requested State</p>
                  <pre className="overflow-x-auto rounded-lg bg-surface-muted p-2">{JSON.stringify(approval.requestedPayload ?? {}, null, 2)}</pre>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle className="text-base">Approval Chain</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              {approval.steps.map((step) => (
                <div key={step.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{formatEnumLabel(step.level)} — {step.requiredRoles.map(formatEnumLabel).join(" / ") || "Any eligible role"}</p>
                    <Badge variant={step.status === "SATISFIED" ? "success" : step.status === "IN_PROGRESS" ? "warning" : "muted"}>{formatEnumLabel(step.status)}</Badge>
                  </div>
                  <p className="text-xs text-muted">Needs {step.quorumCount} of up to {step.requiredCount} eligible approver(s)</p>
                  {step.reviewers.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {step.reviewers.map((r) => (
                        <div key={r.id} className="flex items-center justify-between text-xs">
                          <span>{r.reviewer.name} ({formatEnumLabel(r.reviewer.role)})</span>
                          <Badge variant={r.decision === "APPROVED" ? "success" : r.decision === "REJECTED" ? "danger" : r.decision === "CHANGES_REQUESTED" ? "warning" : "muted"}>{formatEnumLabel(r.decision)}</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Audit Timeline</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {events.map((e) => (
                <div key={e.id} className="border-l-2 border-border pl-3 text-xs">
                  <p className="font-medium">{formatEnumLabel(e.eventType)}</p>
                  <p className="text-muted">{e.actor?.name ?? "System"} · {formatDateTime(e.createdAt)}</p>
                </div>
              ))}
              {events.length === 0 && <p className="text-muted">No events yet.</p>}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Maker</CardTitle></CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <p><span className="text-muted">Requested by:</span> {approval.maker?.name ?? "—"}</p>
              <p><span className="text-muted">Role:</span> {approval.maker ? formatEnumLabel(approval.maker.role) : "—"}</p>
              <p><span className="text-muted">Department:</span> {approval.assignedDepartment?.name ?? "—"}</p>
              {approval.createdTask && (
                <p><span className="text-muted">Review task:</span> {approval.createdTask.taskCode ?? approval.createdTask.id}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Actions</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-2">
              {canDecide && (
                <Button size="sm" onClick={() => callAction("/approve", {}, "Approved")} disabled={busy}>
                  <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                </Button>
              )}
              {canDecide && (
                <Button size="sm" variant="outline" onClick={() => setRejectOpen(true)} disabled={busy}>
                  <XCircle className="h-3.5 w-3.5" /> Reject
                </Button>
              )}
              {canDecide && (
                <Button size="sm" variant="outline" onClick={() => setChangesOpen(true)} disabled={busy}>
                  <RotateCcw className="h-3.5 w-3.5" /> Request Changes
                </Button>
              )}
              {canExecute && (
                <Button size="sm" onClick={() => callAction("/execute", {}, "Executed")} disabled={busy}>
                  <Play className="h-3.5 w-3.5" /> Execute
                </Button>
              )}
              {canDelegate && (
                <Button size="sm" variant="outline" onClick={() => setDelegateOpen(true)} disabled={busy}>
                  <UserCog className="h-3.5 w-3.5" /> Delegate
                </Button>
              )}
              {canEscalate && (
                <Button size="sm" variant="outline" onClick={() => setEscalateOpen(true)} disabled={busy}>
                  <ArrowUpCircle className="h-3.5 w-3.5" /> Escalate
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
        open={rejectOpen} title="Reject Approval Request" description="This action is never executed once rejected. Provide a reason for the audit trail."
        confirmLabel="Reject" danger confirmDisabled={busy || rejectReason.trim().length < 5}
        onConfirm={() => { callAction("/reject", { reason: rejectReason }, "Rejected"); setRejectOpen(false); }}
        onCancel={() => setRejectOpen(false)}
      >
        <Field label="Reason" htmlFor="rejectReason"><Input id="rejectReason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} /></Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={changesOpen} title="Request Changes" description="The maker will be asked to revise and resubmit; any prior decisions on this request are invalidated."
        confirmLabel="Request Changes" confirmDisabled={busy || changesReason.trim().length < 5}
        onConfirm={() => { callAction("/request-changes", { reason: changesReason }, "Changes requested"); setChangesOpen(false); }}
        onCancel={() => setChangesOpen(false)}
      >
        <Field label="What needs to change" htmlFor="changesReason"><Input id="changesReason" value={changesReason} onChange={(e) => setChangesReason(e.target.value)} /></Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={escalateOpen} title="Escalate Approval Request" description="Adds a Super Admin-only review step above the current one."
        confirmLabel="Escalate" danger confirmDisabled={busy || !escalateReason.trim()}
        onConfirm={() => { callAction("/escalate", { reason: escalateReason }, "Escalated"); setEscalateOpen(false); }}
        onCancel={() => setEscalateOpen(false)}
      >
        <Field label="Reason" htmlFor="escalateReason"><Input id="escalateReason" value={escalateReason} onChange={(e) => setEscalateReason(e.target.value)} /></Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={cancelOpen} title="Cancel Approval Request" description="This request will be withdrawn. Provide a reason for the audit trail."
        confirmLabel="Cancel Request" danger confirmDisabled={busy || cancelReason.trim().length < 5}
        onConfirm={() => { callAction("/cancel", { reason: cancelReason }, "Cancelled"); setCancelOpen(false); }}
        onCancel={() => setCancelOpen(false)}
      >
        <Field label="Reason" htmlFor="cancelReason"><Input id="cancelReason" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} /></Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={delegateOpen} title="Delegate My Decision" description="Another eligible admin will be able to decide on this request in your place."
        confirmLabel="Delegate" confirmDisabled={busy || !delegateTo || delegateReason.trim().length < 5}
        onConfirm={() => { callAction("/delegate", { delegateId: delegateTo, reason: delegateReason }, "Delegated"); setDelegateOpen(false); }}
        onCancel={() => setDelegateOpen(false)}
      >
        <Field label="Delegate to" htmlFor="delegateTo">
          <Select id="delegateTo" value={delegateTo} onChange={(e) => setDelegateTo(e.target.value)}>
            <option value="">Select a staff member…</option>
            {staff.filter((s) => s.id !== currentAdminId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Reason" htmlFor="delegateReason"><Input id="delegateReason" value={delegateReason} onChange={(e) => setDelegateReason(e.target.value)} /></Field>
      </ConfirmDialog>
    </div>
  );
}
