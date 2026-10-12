"use client";

import { useState } from "react";
import { Rocket, ShieldCheck, GitCommit, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { StatCard } from "@/components/admin/stat-card";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/utils";
import { Card, KV, Loading, ErrorNote, StatusBadge, SensitiveActionDialog, useApi, callApi, timeAgo } from "@/components/admin/system/shared";

type Status = "GO_LIVE_BLOCKED" | "GO_LIVE_READY" | "GO_LIVE_APPROVED" | "LIVE";
type Action = "MARK_READY" | "APPROVE" | "GO_LIVE" | "BLOCK";

interface GoLive {
  status: Status; commitSha: string | null; currentCommit: string | null; verdict: "READY" | "NOT READY"; unresolved: string[]; drift: string[]; reason: string | null;
  readyBy: string | null; readyAt: string | null; approvedBy: string | null; approvedAt: string | null; liveBy: string | null; liveAt: string | null;
  events: Array<{ id: string; at: string; from: string; to: string; action: string; by: string | null; reason: string | null; commitSha: string | null }>;
}
interface Info {
  environment: string; version: string; commitSha: string | null; deployedAt: string | null;
  release: { code: string; status: string; verifiedAt: string | null } | null;
  previous: { code: string; version: string; commitSha: string; deployedAt: string } | null;
  lastMigration: string | null; migrationCount: number | null;
  health: { overall: string; checks: Record<string, string> };
  backup: { latest: { backupCode: string; status: string; startedAt: string } | null; latestVerified: { backupCode: string; startedAt: string } | null };
  lastRestoreTest: { startedAt: string; status: string } | null;
  lastRestoreDrill: { startedAt: string; status: string; reviewedAt: string | null } | null;
  lastSmoke: { createdAt: string; status: string; commitSha: string } | null;
  switches: Record<string, boolean>;
  flags: Array<{ key: string; enabled: boolean; sensitive: boolean }>;
}

const STEPS: Array<{ status: Status; label: string }> = [
  { status: "GO_LIVE_BLOCKED", label: "Blocked" },
  { status: "GO_LIVE_READY", label: "Ready" },
  { status: "GO_LIVE_APPROVED", label: "Approved" },
  { status: "LIVE", label: "Live" },
];

const TABS = [
  { value: "golive", label: "Go-live approval" },
  { value: "release", label: "Release & health" },
  { value: "flags", label: "Switches & flags" },
];

const ACTION_TEXT: Record<Action, { title: string; hint: string }> = {
  MARK_READY: { title: "Mark ready for go-live", hint: "You are saying every readiness gate passes for this exact build. A different administrator must approve next." },
  APPROVE: { title: "Approve go-live", hint: "You are the second person. You confirm you have looked at the gates and the build. You cannot approve what you marked ready yourself." },
  GO_LIVE: { title: "Record: we are live", hint: "Records that the launch was declared. It does not change any switch - payments and messaging stay exactly as they are." },
  BLOCK: { title: "Block go-live", hint: "Returns to blocked. Nothing is deleted. A reason is required." },
};

export function DeploymentClient({ canManage }: { canManage: boolean }) {
  const { show } = useToast();
  const [tab, setTab] = useState("golive");
  const gl = useApi<GoLive>("/api/admin/go-live");
  const info = useApi<Info>(tab !== "golive" ? "/api/admin/deployment" : null);
  const [action, setAction] = useState<Action | null>(null);

  if (gl.loading && !gl.data) return <Loading />;
  if (gl.error) return <ErrorNote message={gl.error} />;
  if (!gl.data) return null;
  const g = gl.data;
  const stepIndex = STEPS.findIndex((s) => s.status === g.status);
  const buildMatches = !g.commitSha || g.commitSha === g.currentCommit;

  const buttons: Array<{ a: Action; label: string; variant?: "danger" | "outline"; show: boolean; note?: string }> = [
    { a: "MARK_READY", label: "Mark ready", show: g.status === "GO_LIVE_BLOCKED", note: g.verdict !== "READY" ? "Not available while required gates fail." : undefined },
    { a: "APPROVE", label: "Approve go-live", show: g.status === "GO_LIVE_READY" },
    { a: "GO_LIVE", label: "Record as live", show: g.status === "GO_LIVE_APPROVED" },
    { a: "BLOCK", label: "Block", variant: "danger", show: g.status !== "GO_LIVE_BLOCKED" },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Deployment &amp; Go-Live</h1>
        <p className="text-sm text-muted">Go-live is a record of a decision, protected by two people. It cannot be set by hand: it needs every required readiness gate to pass, and a second administrator to approve. It never switches payments, messages or any other feature on.</p>
      </div>

      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      {tab === "golive" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {STEPS.map((s, i) => (
              <div key={s.status} className={`rounded-xl border p-3 text-sm ${i === stepIndex ? "border-primary bg-primary/5 font-semibold" : i < stepIndex ? "border-success/40 text-success" : "border-border text-muted"}`}>
                <div className="text-xs">{i + 1}</div>{s.label}
              </div>
            ))}
          </div>

          <Card title={`Status: ${g.status.replace("GO_LIVE_", "").replace("_", " ")}`} action={<Button size="sm" variant="outline" disabled={gl.loading} onClick={gl.reload}>{gl.loading ? "Checking…" : "Re-check gates"}</Button>}>
            <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
              <KV label="Readiness gates"><StatusBadge status={g.verdict === "READY" ? "PASS" : "BLOCKED"} /> {g.verdict === "READY" ? "all required gates pass" : `${g.unresolved.length} unresolved`}</KV>
              <KV label="Running build"><span className="font-mono text-xs">{g.currentCommit ? g.currentCommit.slice(0, 7) : "not a deployed build"}</span></KV>
              <KV label="Build judged"><span className="font-mono text-xs">{g.commitSha ? g.commitSha.slice(0, 7) : "-"}</span>{g.commitSha && !buildMatches && <span className="ml-2 text-danger">differs from running build</span>}</KV>
              <KV label="Marked ready by">{g.readyBy ? `${g.readyBy} · ${timeAgo(g.readyAt)}` : "-"}</KV>
              <KV label="Approved by">{g.approvedBy ? `${g.approvedBy} · ${timeAgo(g.approvedAt)}` : "-"}</KV>
              <KV label="Recorded live by">{g.liveBy ? `${g.liveBy} · ${timeAgo(g.liveAt)}` : "-"}</KV>
            </dl>
            {g.reason && <p className="mt-2 text-sm text-muted">Last note: {g.reason}</p>}
            {g.drift.length > 0 && <ul className="mt-3 space-y-1 text-sm">{g.drift.map((d) => <li key={d} className="text-warning">• {d}</li>)}</ul>}
          </Card>

          {g.verdict !== "READY" && (
            <Card title="Why it is not ready">
              <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">{g.unresolved.map((u) => <li key={u} className="flex gap-2"><span className="text-danger">•</span><span>{u}</span></li>)}</ul>
              <p className="mt-2 text-xs text-muted">Details and how to fix each one are on the Production Readiness page.</p>
            </Card>
          )}

          {canManage ? (
            <div className="flex flex-wrap items-center gap-2">
              {buttons.filter((b) => b.show).map((b) => (
                <Button key={b.a} size="sm" variant={b.variant} disabled={b.a === "MARK_READY" && g.verdict !== "READY"} onClick={() => setAction(b.a)}>{b.label}</Button>
              ))}
              {g.status === "GO_LIVE_READY" && g.readyBy && <span className="text-xs text-muted">The administrator who marked it ready cannot approve it.</span>}
            </div>
          ) : (
            <p className="text-sm text-muted">You can see the status. Changing it needs the go-live permission (Super Admin).</p>
          )}

          <Card title="History">
            {g.events.length === 0 ? <p className="text-sm text-muted">No change has been recorded yet. The system starts blocked.</p> : (
              <ul className="divide-y divide-border text-sm">
                {g.events.map((e) => (
                  <li key={e.id} className="py-2">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{e.action.replace("_", " ")}</span><span className="text-xs text-muted">{e.from.replace("GO_LIVE_", "")} → {e.to.replace("GO_LIVE_", "")}</span><span className="text-xs text-muted">{e.by ?? "System"} · {formatDateTime(e.at)}</span></div>
                    {e.reason && <div className="text-xs text-muted">{e.reason}</div>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {tab !== "golive" && (info.loading && !info.data ? <Loading /> : info.error ? <ErrorNote message={info.error} /> : info.data && <InfoTabs tab={tab} d={info.data} />)}

      <SensitiveActionDialog
        open={action != null}
        title={action ? ACTION_TEXT[action].title : "Go-live"}
        description={action ? `${ACTION_TEXT[action].hint} Requires your password and is recorded in the audit log.` : ""}
        danger={action === "BLOCK"}
        requireReason={action === "BLOCK"}
        onCancel={() => setAction(null)}
        onConfirm={async ({ reason, stepUpToken }) => {
          if (!action) return null;
          const res = await callApi("/api/admin/go-live", "POST", { action, reason, stepUpToken });
          if (!res.ok) return res.data.error ?? "Action failed";
          show("Go-live status updated", "success");
          gl.reload();
          return null;
        }}
      />
    </div>
  );
}

function InfoTabs({ tab, d }: { tab: string; d: Info }) {
  if (tab === "release") {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard icon={Rocket} label="Environment" value={d.environment} />
          <StatCard icon={ShieldCheck} label="Version" value={d.version} />
          <StatCard icon={GitCommit} label="Commit" value={d.commitSha ? d.commitSha.slice(0, 7) : "local"} />
          <StatCard icon={Database} label="Migrations applied" value={d.migrationCount ?? "unknown"} />
        </div>
        <Card title="This release">
          <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            <KV label="Release record">{d.release ? <span>{d.release.code} <StatusBadge status={d.release.status} /></span> : "not recorded (not a deployed build)"}</KV>
            <KV label="Deployed">{d.deployedAt ? `${formatDateTime(d.deployedAt)} (${timeAgo(d.deployedAt)})` : "-"}</KV>
            <KV label="Latest migration"><span className="font-mono text-xs">{d.lastMigration ?? "unknown"}</span></KV>
            <KV label="Previous healthy release">{d.previous ? `${d.previous.version} · ${formatDateTime(d.previous.deployedAt)}` : "none recorded"}</KV>
            <KV label="Overall health"><StatusBadge status={d.health.overall} /></KV>
            <KV label="Last smoke test">{d.lastSmoke ? <span>{timeAgo(d.lastSmoke.createdAt)} <StatusBadge status={d.lastSmoke.status} /></span> : "never"}</KV>
          </dl>
        </Card>
        <Card title="Health checks">
          <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">{Object.entries(d.health.checks).map(([k, v]) => <KV key={k} label={k}><StatusBadge status={v} /></KV>)}</dl>
        </Card>
        <Card title="Backups and recovery proof">
          <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            <KV label="Latest backup">{d.backup.latest ? <span>{d.backup.latest.backupCode} · {timeAgo(d.backup.latest.startedAt)} <StatusBadge status={d.backup.latest.status} /></span> : "none"}</KV>
            <KV label="Latest completed backup">{d.backup.latestVerified ? `${d.backup.latestVerified.backupCode} · ${timeAgo(d.backup.latestVerified.startedAt)}` : "none"}</KV>
            <KV label="Last restore test">{d.lastRestoreTest ? <span>{timeAgo(d.lastRestoreTest.startedAt)} <StatusBadge status={d.lastRestoreTest.status} /></span> : "never"}</KV>
            <KV label="Last restore drill">{d.lastRestoreDrill ? <span>{timeAgo(d.lastRestoreDrill.startedAt)} <StatusBadge status={d.lastRestoreDrill.status} />{d.lastRestoreDrill.reviewedAt ? " reviewed" : " not reviewed"}</span> : "never"}</KV>
          </dl>
        </Card>
      </div>
    );
  }
  const on = d.flags.filter((f) => f.enabled).length;
  return (
    <div className="space-y-4">
      <Card title="Emergency switches">
        <p className="mb-2 text-xs text-muted">A switch that is ON stops that activity. Nothing is deleted; turning it off again restores it. Change them in System Configuration.</p>
        <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">{Object.entries(d.switches).map(([k, v]) => <KV key={k} label={k}>{v ? <span className="text-danger">STOPPED</span> : <span className="text-success">running</span>}</KV>)}</dl>
      </Card>
      <Card title={`Feature flags (${on} of ${d.flags.length} on)`}>
        <ul className="divide-y divide-border text-sm">
          {d.flags.map((f) => <li key={f.key} className="flex items-center justify-between py-1.5"><span className="font-mono text-xs">{f.key}</span><span className={f.enabled ? "text-success" : "text-muted"}>{f.enabled ? "on" : "off"}</span></li>)}
        </ul>
      </Card>
    </div>
  );
}
