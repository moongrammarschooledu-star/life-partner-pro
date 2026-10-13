"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { Card, ErrorNote, Loading, SensitiveActionDialog, callApi, useApi } from "@/components/admin/system/shared";
import { ApprovalNote, ChangeDialog, CcHeader, Table, fmt, sendChange } from "@/components/admin/platform/cc-shared";

interface Freeze { id: string; reason: string; startsAt: string; endsAt: string | null; createdById: string; endedAt: string | null; endedById: string | null }
interface BreakGlass { id: string; adminId: string; reason: string; grantedAt: string; expiresAt: string; endedAt: string | null; actionsCount: number; reviewedById: string | null; reviewedAt: string | null; reviewNote: string | null }
interface Data {
  environment: string;
  kinds: string[];
  applicantBehaviour: Record<string, string>;
  apiBehaviour: Record<string, string>;
  maintenance: { kind: string; active: boolean; startsAt: string | null; endsAt: string | null; message: string | null; adminAccess: string };
  activeFreeze: Freeze | null;
  freezes: Freeze[];
  breakGlass: BreakGlass[];
  canManage: boolean;
  canFreeze: boolean;
  canBreakGlass: boolean;
}

const KIND_LABEL: Record<string, string> = { NORMAL: "Normal operation", SCHEDULED_MAINTENANCE: "Scheduled maintenance", EMERGENCY_MAINTENANCE: "Emergency maintenance", READ_ONLY: "Read-only mode" };
const toLocalInput = (v: string | null) => (v ? new Date(new Date(v).getTime() - new Date(v).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
const toIso = (v: string) => (v ? new Date(v).toISOString() : undefined);

export function MaintenanceClient({ permissions }: { permissions: string[] }) {
  const { data, error, loading, reload } = useApi<Data>("/api/admin/platform/maintenance");
  const { show } = useToast();
  const [kind, setKind] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [dialog, setDialog] = useState<"maintenance" | "freeze-start" | "freeze-end" | "bg-grant" | "bg-end" | null>(null);
  const [freezeEnds, setFreezeEnds] = useState("");
  const [minutes, setMinutes] = useState("30");
  const [review, setReview] = useState<BreakGlass | null>(null);
  const [approval, setApproval] = useState<string | null>(null);

  const current = kind ?? data?.maintenance.kind ?? "NORMAL";
  const myBreakGlass = data?.breakGlass.find((b) => !b.endedAt && new Date(b.expiresAt) > new Date());
  const pendingReview = (data?.breakGlass ?? []).filter((b) => !b.reviewedAt && (b.endedAt || new Date(b.expiresAt) <= new Date()));

  return (
    <div className="space-y-4">
      <CcHeader title="Maintenance, change freeze and break-glass" description="Control whether the platform is open, in maintenance or read-only; freeze configuration changes during a release; and grant a short, reviewed exception in an emergency. Administrators can always sign in and reach this area." permissions={permissions} environment={data?.environment} />
      {loading && <Loading />}
      {error && <ErrorNote message={error} />}
      {approval && <ApprovalNote code={approval} onClose={() => setApproval(null)} />}
      {data && (
        <>
          <Card title="Maintenance mode">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge variant={data.maintenance.kind === "NORMAL" ? "success" : "warning"}>{KIND_LABEL[data.maintenance.kind]}</Badge>
              {data.maintenance.kind !== "NORMAL" && <span className="text-sm text-muted">{data.maintenance.active ? "in effect now" : "not in effect yet"}{data.maintenance.endsAt ? ` · until ${fmt(data.maintenance.endsAt)}` : ""}</span>}
            </div>
            <p className="mb-3 text-sm text-muted">{data.maintenance.adminAccess}</p>
            {data.canManage ? (
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Mode" htmlFor="mm-kind"><Select id="mm-kind" value={current} onChange={(e) => setKind(e.target.value)}>{data.kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</Select></Field>
                <div className="rounded-lg border border-border p-3 text-sm"><p className="font-medium">What people experience</p><p className="mt-1 text-muted">{data.applicantBehaviour[current]}</p><p className="mt-2 font-medium">What the API does</p><p className="mt-1 text-muted">{data.apiBehaviour[current]}</p></div>
                {current !== "NORMAL" && current !== "READ_ONLY" && (
                  <>
                    {current === "SCHEDULED_MAINTENANCE" && <Field label="Starts" htmlFor="mm-start"><Input id="mm-start" type="datetime-local" value={startsAt || toLocalInput(data.maintenance.startsAt)} onChange={(e) => setStartsAt(e.target.value)} /></Field>}
                    <Field label="Ends (recommended)" htmlFor="mm-end"><Input id="mm-end" type="datetime-local" value={endsAt || toLocalInput(data.maintenance.endsAt)} onChange={(e) => setEndsAt(e.target.value)} /></Field>
                  </>
                )}
                {current !== "NORMAL" && <Field label="Message shown to the public (no internal detail)" className="md:col-span-2" htmlFor="mm-msg"><Textarea id="mm-msg" maxLength={300} value={message || data.maintenance.message || ""} onChange={(e) => setMessage(e.target.value)} /></Field>}
              </div>
            ) : <p className="text-sm text-muted">You can view this but not change it.</p>}
            {data.canManage && <div className="mt-3"><Button disabled={current === data.maintenance.kind && !message && !startsAt && !endsAt} onClick={() => setDialog("maintenance")}>Apply</Button></div>}
          </Card>

          <Card title="Change freeze">
            {data.activeFreeze ? (
              <div className="space-y-2 text-sm">
                <p><Badge variant="warning">Active</Badge> since {fmt(data.activeFreeze.startsAt)}{data.activeFreeze.endsAt ? ` · ends ${fmt(data.activeFreeze.endsAt)}` : " · no end set"}</p>
                <p className="text-muted">Reason: {data.activeFreeze.reason}</p>
                <p className="text-muted">Configuration changes are refused while this is active, except a break-glass exception or an emergency switch-off by someone allowed to freeze changes.</p>
                {data.canFreeze && <Button variant="outline" onClick={() => setDialog("freeze-end")}>End the freeze</Button>}
              </div>
            ) : (
              <div className="space-y-2 text-sm">
                <p className="text-muted">No freeze is active, so configuration changes are allowed.</p>
                {data.canFreeze && <div className="flex flex-wrap items-end gap-3"><Field label="Ends (optional)" htmlFor="fz-end"><Input id="fz-end" type="datetime-local" value={freezeEnds} onChange={(e) => setFreezeEnds(e.target.value)} /></Field><Button onClick={() => setDialog("freeze-start")}>Start a change freeze</Button></div>}
              </div>
            )}
            {data.freezes.length > 0 && <div className="mt-4"><Table head={["Started", "Ended", "Reason"]}>{data.freezes.map((f) => <tr key={f.id}><td className="px-2 py-1.5">{fmt(f.startsAt)}</td><td className="px-2 py-1.5 text-muted">{f.endedAt ? fmt(f.endedAt) : f.endsAt ? `due ${fmt(f.endsAt)}` : "open"}</td><td className="px-2 py-1.5 text-muted">{f.reason}</td></tr>)}</Table></div>}
          </Card>

          {(data.canBreakGlass || data.breakGlass.length > 0) && (
            <Card title="Break-glass">
              <p className="mb-3 text-sm text-muted">A short, logged exception that lets you change configuration during a freeze. It does not change your role or give you any permission. Another administrator must review every use.</p>
              {data.canBreakGlass && (
                <div className="mb-3 flex flex-wrap items-end gap-3">
                  {myBreakGlass ? <Button variant="outline" onClick={() => setDialog("bg-end")}>End my break-glass now</Button> : (
                    <>
                      <Field label="Minutes (5 to 60)" htmlFor="bg-min"><Input id="bg-min" type="number" min={5} max={60} value={minutes} onChange={(e) => setMinutes(e.target.value)} /></Field>
                      <Button variant="danger" onClick={() => setDialog("bg-grant")}>Use break-glass</Button>
                    </>
                  )}
                </div>
              )}
              {pendingReview.length > 0 && <p className="mb-2 text-sm font-medium">Waiting for review: {pendingReview.length}</p>}
              <Table head={["Who", "When", "Until", "Changes made", "Reviewed", ""]} empty={data.breakGlass.length === 0 ? "Break-glass has not been used." : undefined}>
                {data.breakGlass.map((b) => (
                  <tr key={b.id} className="align-top">
                    <td className="px-2 py-1.5">{b.adminId}<p className="text-xs text-muted">{b.reason}</p></td>
                    <td className="px-2 py-1.5 text-muted">{fmt(b.grantedAt)}</td>
                    <td className="px-2 py-1.5 text-muted">{b.endedAt ? `ended ${fmt(b.endedAt)}` : fmt(b.expiresAt)}</td>
                    <td className="px-2 py-1.5">{b.actionsCount}</td>
                    <td className="px-2 py-1.5 text-muted">{b.reviewedAt ? `${b.reviewedById} · ${fmt(b.reviewedAt)}` : "Not yet"}</td>
                    <td className="px-2 py-1.5 text-right">{!b.reviewedAt && (b.endedAt || new Date(b.expiresAt) <= new Date()) && data.canBreakGlass && <Button size="sm" variant="outline" onClick={() => setReview(b)}>Review</Button>}</td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}
        </>
      )}

      <ChangeDialog
        open={dialog === "maintenance"}
        danger={current === "EMERGENCY_MAINTENANCE"}
        title={`Switch to: ${KIND_LABEL[current] ?? current}`}
        description="This takes effect straight away. Administrators, sign-in, health checks, payment callbacks and background jobs keep working."
        environment={data?.environment ?? "PRODUCTION"}
        onCancel={() => setDialog(null)}
        submit={async ({ reason, stepUpToken, environment }) => {
          const res = await sendChange("/api/admin/platform/maintenance", "PATCH", { kind: current, startsAt: toIso(startsAt), endsAt: toIso(endsAt), message: message || undefined, reason, environment, stepUpToken });
          if (res.error) return res.error;
          if (res.approvalCode) setApproval(res.approvalCode); else show("Maintenance mode updated.", "success");
          setDialog(null); setKind(null); setMessage(""); setStartsAt(""); setEndsAt(""); reload();
          return null;
        }}
      />
      <ChangeDialog
        open={dialog === "freeze-start"}
        title="Start a change freeze"
        description="Configuration changes will be refused until the freeze ends."
        environment={data?.environment ?? "PRODUCTION"}
        onCancel={() => setDialog(null)}
        submit={async ({ reason, stepUpToken, environment }) => {
          const res = await sendChange("/api/admin/platform/change-freeze", "POST", { action: "START", reason, endsAt: toIso(freezeEnds), environment, stepUpToken });
          if (res.error) return res.error;
          show("Change freeze started.", "success"); setDialog(null); setFreezeEnds(""); reload();
          return null;
        }}
      />
      <ChangeDialog
        open={dialog === "freeze-end"}
        title="End the change freeze"
        description="Configuration changes will be allowed again."
        environment={data?.environment ?? "PRODUCTION"}
        onCancel={() => setDialog(null)}
        submit={async ({ reason, stepUpToken, environment }) => {
          const res = await sendChange("/api/admin/platform/change-freeze", "POST", { action: "END", reason, environment, stepUpToken });
          if (res.error) return res.error;
          show("Change freeze ended.", "success"); setDialog(null); reload();
          return null;
        }}
      />
      <ChangeDialog
        open={dialog === "bg-grant"}
        danger
        title="Use break-glass"
        description="You will be able to change configuration during the freeze for the minutes you chose. Every change you make is flagged for review by another administrator."
        environment={data?.environment ?? "PRODUCTION"}
        onCancel={() => setDialog(null)}
        submit={async ({ reason, stepUpToken, environment }) => {
          const res = await sendChange("/api/admin/platform/break-glass", "POST", { action: "GRANT", reason, minutes: Number(minutes), environment, stepUpToken });
          if (res.error) return res.error;
          show("Break-glass granted.", "success"); setDialog(null); reload();
          return null;
        }}
      />
      <ChangeDialog
        open={dialog === "bg-end"}
        title="End break-glass"
        description="The exception ends immediately."
        environment={data?.environment ?? "PRODUCTION"}
        onCancel={() => setDialog(null)}
        submit={async ({ reason, stepUpToken, environment }) => {
          const res = await sendChange("/api/admin/platform/break-glass", "POST", { action: "END", reason, environment, stepUpToken });
          if (res.error) return res.error;
          show("Break-glass ended.", "success"); setDialog(null); reload();
          return null;
        }}
      />
      <SensitiveActionDialog
        open={review !== null}
        title="Review a break-glass use"
        description="Confirm you have looked at what was changed during this exception. You cannot review your own use."
        requireReason
        onCancel={() => setReview(null)}
        onConfirm={async ({ reason, stepUpToken }) => {
          if (!review) return null;
          const res = await callApi("/api/admin/platform/break-glass", "POST", { action: "REVIEW", id: review.id, note: reason, stepUpToken });
          if (!res.ok) return res.data.error ?? "The review was not saved.";
          show("Review recorded.", "success"); setReview(null); reload();
          return null;
        }}
      />
    </div>
  );
}
