"use client";

import { useState } from "react";
import { CheckCircle2, ShieldCheck, ShieldAlert, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { StatCard } from "@/components/admin/stat-card";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/utils";
import { Card, KV, Loading, ErrorNote, StatusBadge, SensitiveActionDialog, useApi, callApi, timeAgo } from "@/components/admin/system/shared";

interface Gate { id: string; category: string; title: string; required: boolean; status: string; detail: string; remediation?: string }
interface Score { category: string; status: string; blocking: string[]; warnings: string[] }
interface Readiness {
  verdict: "READY" | "NOT READY"; unresolved: string[]; gates: Gate[]; scorecard: Score[];
  status: { environment: string; version: string; database: string; backup: string; monitoring: string; security: string; payment: string; webhook: string; deployment: string; lastSmokeTest: { at: string; status: string } | null; lastSecurityTest: { at: string; status: string } | null; lastBackup: { at: string; code: string } | null; lastRestoreTest: { at: string; status: string } | null; openCriticalIncidents: number; release: { code: string; status: string } | null };
  evidence: Array<{ id: string; kind: string; status: string; commitSha: string; createdAt: string; environment: string | null }>;
}
interface Release { id: string; releaseCode: string; version: string; commitSha: string; environment: string; status: string; deployedAt: string; approvedAt: string | null; verifiedAt: string | null; verificationResult: Record<string, string> | null; monitoringUntil: string | null; rollbackTarget: { releaseCode: string; version: string } | null; rollbackAssessment: { verdict: string; message: string; newerMigrations: string[] } | null }

const TABS = [
  { value: "status", label: "Final Status" },
  { value: "gates", label: "Gates" },
  { value: "scorecard", label: "Scorecard" },
  { value: "releases", label: "Releases" },
  { value: "evidence", label: "CI Evidence" },
];

export function ReadinessClient({ canRunTests, canManageReleases }: { canRunTests: boolean; canManageReleases: boolean }) {
  const { show } = useToast();
  const [tab, setTab] = useState("status");
  const { data, error, loading, reload, updatedAt } = useApi<Readiness>("/api/admin/system/readiness");
  const releases = useApi<{ items: Release[] }>(tab === "releases" ? "/api/admin/system/releases" : null);
  const [busy, setBusy] = useState(false);
  const [releaseAction, setReleaseAction] = useState<{ id: string; action: "approve" | "record_rollback" | "reverify"; code: string } | null>(null);

  async function selfTest() {
    setBusy(true);
    try {
      const res = await callApi<{ passed: boolean }>("/api/admin/system/readiness", "POST", { action: "selftest" });
      show(res.ok ? (res.data.passed ? "Monitoring self-test passed" : "Monitoring self-test FAILED") : res.data.error ?? "Could not run", res.ok && res.data.passed ? "success" : "error");
      reload();
    } finally { setBusy(false); }
  }

  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;
  const ready = data.verdict === "READY";
  const s = data.status;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Life Partner Pro — Production Readiness</h1>
          <p className="text-sm text-muted">Computed from live system state and fresh pipeline evidence{updatedAt ? ` — last evaluated ${updatedAt.toLocaleTimeString()}` : ""}. It cannot be marked READY by hand: a gate passes only when there is positive proof.</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={loading} onClick={reload}>{loading ? "Evaluating… (can take ~10 s)" : "Re-evaluate"}</Button>
          {canRunTests && <Button size="sm" disabled={busy} onClick={selfTest}>{busy ? "Running…" : "Run monitoring self-test"}</Button>}
        </div>
      </div>

      <div className={`rounded-xl border p-4 ${ready ? "border-success/40 bg-success/5" : "border-danger/40 bg-danger/5"}`}>
        <div className="flex items-center gap-3">
          {ready ? <CheckCircle2 className="h-6 w-6 text-success" /> : <ShieldAlert className="h-6 w-6 text-danger" />}
          <div>
            <div className="text-lg font-semibold">{data.verdict}</div>
            <div className="text-sm text-muted">{ready ? "Every required gate has passed." : `${data.unresolved.length} required gate(s) unresolved — production deployment is not approved.`}</div>
          </div>
        </div>
        {!ready && (
          <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto text-sm">
            {data.unresolved.map((u) => <li key={u} className="flex gap-2"><span className="text-danger">•</span><span>{u}</span></li>)}
          </ul>
        )}
      </div>

      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      {tab === "status" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard icon={Activity} label="Environment" value={s.environment} />
            <StatCard icon={ShieldCheck} label="Version" value={s.version} />
            <StatCard icon={ShieldAlert} label="Open critical incidents" value={s.openCriticalIncidents} accent={s.openCriticalIncidents > 0 ? "danger" : "success"} />
            <StatCard icon={ShieldCheck} label="Release" value={s.release ? `${s.release.code} · ${s.release.status}` : "not recorded"} accent={s.release?.status === "HEALTHY" ? "success" : "muted"} />
          </div>
          <Card title="Status by area">
            <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
              <KV label="Database"><StatusBadge status={s.database} /></KV>
              <KV label="Backup"><StatusBadge status={s.backup === "PASS" ? "PASS" : s.backup} /></KV>
              <KV label="Monitoring"><StatusBadge status={s.monitoring} /></KV>
              <KV label="Security"><StatusBadge status={s.security} /></KV>
              <KV label="Payments"><StatusBadge status={s.payment} /></KV>
              <KV label="Webhooks"><StatusBadge status={s.webhook} /></KV>
              <KV label="Deployment"><StatusBadge status={s.deployment} /></KV>
              <KV label="Last smoke test">{s.lastSmokeTest ? <span>{timeAgo(s.lastSmokeTest.at)} <StatusBadge status={s.lastSmokeTest.status} /></span> : "never"}</KV>
              <KV label="Last security test">{s.lastSecurityTest ? <span>{timeAgo(s.lastSecurityTest.at)} <StatusBadge status={s.lastSecurityTest.status} /></span> : "never"}</KV>
              <KV label="Last backup">{s.lastBackup ? `${s.lastBackup.code} · ${timeAgo(s.lastBackup.at)}` : "none"}</KV>
              <KV label="Last restore test">{s.lastRestoreTest ? <span>{timeAgo(s.lastRestoreTest.at)} <StatusBadge status={s.lastRestoreTest.status} /></span> : "never"}</KV>
            </dl>
          </Card>
        </div>
      )}

      {tab === "gates" && (
        <div className="space-y-2">
          {data.gates.map((g) => (
            <div key={g.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-surface p-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><StatusBadge status={g.status} /><span className="font-medium">{g.title}</span><span className="text-xs text-muted">{g.category}{g.required ? " · required" : " · advisory"}</span></div>
                <div className="mt-1 text-sm text-muted">{g.detail}</div>
                {g.status !== "PASS" && g.remediation && <div className="mt-1 text-xs">To resolve: {g.remediation}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "scorecard" && (
        <div className="space-y-2">
          <p className="text-xs text-muted">Per-category status only — deliberately no overall numeric score. A BLOCKED category always names its exact blocking issue.</p>
          {data.scorecard.map((c) => (
            <Card key={c.category}>
              <div className="flex items-center justify-between"><span className="font-medium">{c.category}</span><StatusBadge status={c.status} /></div>
              {c.blocking.length > 0 && <ul className="mt-2 space-y-1 text-sm">{c.blocking.map((b) => <li key={b} className="text-danger">• {b}</li>)}</ul>}
              {c.warnings.length > 0 && <ul className="mt-2 space-y-1 text-sm">{c.warnings.map((w) => <li key={w} className="text-muted">• {w}</li>)}</ul>}
            </Card>
          ))}
        </div>
      )}

      {tab === "releases" && (
        releases.loading && !releases.data ? <Loading /> : releases.error ? <ErrorNote message={releases.error} /> : (
          <div className="space-y-3">
            {(releases.data?.items ?? []).length === 0 && <p className="text-sm text-muted">No releases recorded yet. They are registered automatically the first time a deployed build starts.</p>}
            {(releases.data?.items ?? []).map((r) => (
              <Card key={r.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-sm">{r.releaseCode}</span><StatusBadge status={r.status} /><span className="text-xs text-muted">{r.environment}</span>{r.approvedAt && <span className="text-xs text-success">approved {timeAgo(r.approvedAt)}</span>}</div>
                    <div className="mt-1 text-sm">{r.version} <span className="font-mono text-xs text-muted">{r.commitSha.slice(0, 7)}</span></div>
                    <div className="text-xs text-muted">Deployed {formatDateTime(r.deployedAt)}{r.monitoringUntil ? ` · monitoring until ${formatDateTime(r.monitoringUntil)}` : ""}</div>
                    {r.verificationResult && <div className="text-xs text-muted">Verification: {Object.entries(r.verificationResult).map(([k, v]) => `${k}=${v}`).join(", ")}</div>}
                    {r.rollbackTarget && r.rollbackAssessment && (
                      <div className="mt-2 rounded-lg bg-surface-muted p-2 text-xs">Rollback target {r.rollbackTarget.releaseCode} ({r.rollbackTarget.version}): <StatusBadge status={r.rollbackAssessment.verdict === "SAFE" ? "PASS" : "WARN"} /> {r.rollbackAssessment.message}</div>
                    )}
                  </div>
                  {canManageReleases && (
                    <div className="flex gap-2">
                      {r.status === "HEALTHY" && !r.approvedAt && <Button size="sm" onClick={() => setReleaseAction({ id: r.id, action: "approve", code: r.releaseCode })}>Approve</Button>}
                      <Button size="sm" variant="outline" onClick={() => setReleaseAction({ id: r.id, action: "reverify", code: r.releaseCode })}>Re-verify</Button>
                      <Button size="sm" variant="danger" onClick={() => setReleaseAction({ id: r.id, action: "record_rollback", code: r.releaseCode })}>Record rollback</Button>
                    </div>
                  )}
                </div>
              </Card>
            ))}
            <p className="text-xs text-muted">Rolling back the deployment itself is done in Vercel (promote the previous deployment). Recording it here checks database compatibility and keeps the audit trail.</p>
          </div>
        )
      )}

      {tab === "evidence" && (
        <Card title="Pipeline evidence (latest 30)">
          <p className="mb-3 text-xs text-muted">Posted by the CI / deploy-gate workflows using CI_EVIDENCE_TOKEN. Evidence for build/test/security stages only counts when it was recorded for the commit that is deployed.</p>
          {data.evidence.length === 0 ? <p className="text-sm text-muted">No evidence recorded yet — the pipeline has not reported to this environment.</p> : (
            <table className="w-full text-sm">
              <tbody>
                {data.evidence.map((e) => <tr key={e.id} className="border-b border-border last:border-0"><td className="py-2 font-mono text-xs">{e.kind}</td><td className="py-2"><StatusBadge status={e.status} /></td><td className="py-2 font-mono text-xs text-muted">{e.commitSha.slice(0, 7)}</td><td className="py-2 text-muted">{formatDateTime(e.createdAt)}</td></tr>)}
              </tbody>
            </table>
          )}
        </Card>
      )}

      <SensitiveActionDialog
        open={releaseAction != null}
        title={releaseAction ? `${releaseAction.action === "approve" ? "Approve" : releaseAction.action === "reverify" ? "Re-verify" : "Record rollback of"} ${releaseAction.code}` : "Release"}
        description="Requires your password and is recorded in the audit log."
        danger={releaseAction?.action === "record_rollback"}
        requireReason={releaseAction?.action === "record_rollback"}
        onCancel={() => setReleaseAction(null)}
        onConfirm={async ({ reason, stepUpToken }) => {
          if (!releaseAction) return null;
          const res = await callApi("/api/admin/system/releases", "POST", { releaseId: releaseAction.id, action: releaseAction.action, reason, stepUpToken });
          if (!res.ok) return res.data.error ?? "Action failed";
          show("Release updated", "success");
          releases.reload(); reload();
          return null;
        }}
      />
    </div>
  );
}
