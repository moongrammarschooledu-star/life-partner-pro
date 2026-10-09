"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { Card, ErrorNote, KV, Loading, StatusBadge, callApi, useApi } from "@/components/admin/system/shared";
import { CheckBadge, ReadinessBadge, SeverityBadge, SocHeader, Source, Stat, Table, fmt, makeCan, minutesLabel } from "@/components/admin/soc/shared";

interface Overview {
  generatedAt: string;
  readiness: { state: string; checks: Array<{ key: string; label: string; status: string; detail: string }>; counts: Record<string, number> };
  alerts: { open: number; unacknowledged: number; bySeverity: Record<string, number>; newest: Array<{ id: string; alertCode: string; title: string; severity: string; status: string; createdAt: string }> };
  incidents: { open: number; bySeverity: Record<string, number>; newest: Array<{ id: string; incidentCode: string; title: string; severity: string; status: string; createdAt: string }> };
  criticalAndHigh: { alerts: number; incidents: number };
  signals24h: { items: Array<{ key: string; label: string; count: number }>; source: string };
  adminLogins24h: { success: number; failure: number; locked: number; source: string };
  webhooks24h: { rejected: number; failed: number; marketingRejected: number; source: string };
  adminSecurity: { activeSessions: number; privilegedAdmins: number; mfaGaps: number; enforceMfaPrivileged: boolean; sessionIdleMinutes: number | null; maxConcurrentSessions: number | null };
  systemHealth: { database: { status: string; latencyMs: number }; fileBackupCoverage: { sources: number; mirrored: number }; infrastructureAlertsOpen: Record<string, number>; source: string };
  backups: { health: string; reasons: string[]; lastBackup: { code: string; startedAt: string } | null; lastVerified: { code: string; startedAt: string } | null };
  restore: { hasProof: boolean; lastProven: { completedAt: string | null; environmentLabel: string } | null; lastAttempt: { status: string; at: string } | null };
  disasterRecovery: { configured: { rtoMinutes: number; rpoMinutes: number }; measured: { rpoMinutes: number | null; rtoMinutes: number | null }; comparison: { rpo: string; rto: string }; planVersion: number | null; testsOverdue: boolean };
  detection: { enabled: boolean; escalationEnabled: boolean; lastRunAt: string | null; lastSummary: { alertsCreated?: number; findings?: number; errors?: unknown[]; truncated?: unknown[] } | null };
  recentAudit: Array<{ id: string; action: string; adminId: string | null; createdAt: string }>;
}

export function OverviewClient({ permissions }: { permissions: string[] }) {
  const can = makeCan(permissions);
  const { show } = useToast();
  const { data, error, loading, reload } = useApi<Overview>("/api/admin/soc");
  const [running, setRunning] = useState(false);

  async function runNow() {
    setRunning(true);
    const res = await callApi<{ detection?: { skipped?: boolean; reason?: string; alertsCreated?: number; errors?: string[] } }>("/api/admin/soc/detection/run", "POST", {});
    setRunning(false);
    if (!res.ok) return show(res.data.error ?? "The run did not start.", "error");
    const d = res.data.detection;
    show(d?.skipped ? (d.reason ?? "Detection is switched off.") : `Detection finished: ${d?.alertsCreated ?? 0} new alert(s)${d?.errors?.length ? `, ${d.errors.length} error(s)` : ""}.`, d?.skipped ? "info" : "success");
    reload();
  }

  return (
    <div className="space-y-4">
      <SocHeader title="Security Operations" description="One view of security alerts, incidents, administrator access, backups and recovery. Every figure is read from the database when the page opens and names its source; where there is nothing to count it says so." can={can} />
      {loading && <Loading />}
      {error && <ErrorNote message={error} />}
      {data && (
        <>
          <Card title="Readiness" action={<ReadinessBadge state={data.readiness.state} />}>
            <p className="mb-3 text-sm text-muted">Computed from the checks below on every visit. A check passes only on evidence — missing data is a warning, never a pass.</p>
            <Table head={["Check", "Status", "Detail"]}>
              {data.readiness.checks.map((c) => (
                <tr key={c.key}><td className="px-2 py-2">{c.label}</td><td className="px-2 py-2"><CheckBadge status={c.status} /></td><td className="px-2 py-2 text-muted">{c.detail}</td></tr>
              ))}
            </Table>
          </Card>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Open alerts" value={data.alerts.open} hint={`${data.alerts.unacknowledged} not acknowledged`} tone={data.alerts.unacknowledged ? "warning" : undefined} />
            <Stat label="Open incidents" value={data.incidents.open} />
            <Stat label="Critical + high findings" value={data.criticalAndHigh.alerts + data.criticalAndHigh.incidents} hint={`${data.criticalAndHigh.alerts} alerts, ${data.criticalAndHigh.incidents} incidents`} tone={data.criticalAndHigh.alerts + data.criticalAndHigh.incidents ? "danger" : undefined} />
            <Stat label="Active admin sessions" value={data.adminSecurity.activeSessions} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Active security alerts" action={can("soc:alerts:view") ? <Link className="text-sm text-primary hover:underline" href="/admin/security-operations/alerts">All alerts</Link> : undefined}>
              {data.alerts.newest.length === 0 ? <EmptyState title="No open alerts" description="Nothing has been raised, or everything raised has been handled." /> : (
                <Table head={["Alert", "Severity", "Status", "Raised"]}>
                  {data.alerts.newest.map((a) => (
                    <tr key={a.id}><td className="px-2 py-2"><Link className="text-primary hover:underline" href={`/admin/security-operations/alerts?open=${a.id}`}>{a.alertCode}</Link><div className="text-xs text-muted">{a.title}</div></td><td className="px-2 py-2"><SeverityBadge severity={a.severity} /></td><td className="px-2 py-2"><StatusBadge status={a.status} /></td><td className="px-2 py-2 text-muted">{fmt(a.createdAt)}</td></tr>
                  ))}
                </Table>
              )}
              <Source>SocAlert</Source>
            </Card>
            <Card title="Open incidents" action={can("soc:incidents:view") ? <Link className="text-sm text-primary hover:underline" href="/admin/security-operations/incidents">All incidents</Link> : undefined}>
              {data.incidents.newest.length === 0 ? <EmptyState title="No open incidents" /> : (
                <Table head={["Incident", "Severity", "Stage", "Opened"]}>
                  {data.incidents.newest.map((i) => (
                    <tr key={i.id}><td className="px-2 py-2"><Link className="text-primary hover:underline" href={`/admin/security-operations/incidents/${i.id}`}>{i.incidentCode}</Link><div className="text-xs text-muted">{i.title}</div></td><td className="px-2 py-2"><SeverityBadge severity={i.severity} /></td><td className="px-2 py-2"><StatusBadge status={i.status} /></td><td className="px-2 py-2 text-muted">{fmt(i.createdAt)}</td></tr>
                  ))}
                </Table>
              )}
              <Source>SocIncident</Source>
            </Card>
          </div>

          <Card title="Signals in the last 24 hours">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {data.signals24h.items.map((s) => <Stat key={s.key} label={s.label} value={s.count} />)}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 md:grid-cols-6">
              <Stat label="Admin sign-ins OK" value={data.adminLogins24h.success} />
              <Stat label="Admin sign-ins failed" value={data.adminLogins24h.failure} />
              <Stat label="Accounts locked" value={data.adminLogins24h.locked} />
              <Stat label="Webhooks rejected" value={data.webhooks24h.rejected} />
              <Stat label="Webhooks failed" value={data.webhooks24h.failed} />
              <Stat label="Marketing webhooks rejected" value={data.webhooks24h.marketingRejected} />
            </div>
            <Source at={data.generatedAt}>{data.signals24h.source}; AdminLoginHistory; WebhookEvent; MarketingWebhookEvent</Source>
          </Card>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Administrator security">
              <dl>
                <KV label="Privileged administrators">{data.adminSecurity.privilegedAdmins}</KV>
                <KV label="Without a second step">{data.adminSecurity.mfaGaps}</KV>
                <KV label="Enforced for privileged roles">{data.adminSecurity.enforceMfaPrivileged ? "Yes" : "No"}</KV>
                <KV label="Idle timeout">{data.adminSecurity.sessionIdleMinutes ? `${data.adminSecurity.sessionIdleMinutes} min` : "Not set"}</KV>
                <KV label="Session cap">{data.adminSecurity.maxConcurrentSessions ?? "Not set"}</KV>
              </dl>
            </Card>
            <Card title="Database and storage">
              <dl>
                <KV label="Database"><StatusBadge status={data.systemHealth.database.status} /> {data.systemHealth.database.latencyMs} ms</KV>
                <KV label="Files covered by backup">{data.systemHealth.fileBackupCoverage.mirrored} of {data.systemHealth.fileBackupCoverage.sources}</KV>
                <KV label="Open infrastructure alerts">{Object.entries(data.systemHealth.infrastructureAlertsOpen).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}</KV>
              </dl>
              <Source>{data.systemHealth.source}</Source>
            </Card>
            <Card title="Detection" action={can("soc:detection:run") ? <Button size="sm" variant="outline" onClick={runNow} disabled={running}>{running ? "Running…" : "Run now"}</Button> : undefined}>
              <dl>
                <KV label="Threat detection">{data.detection.enabled ? "On" : "Off"}</KV>
                <KV label="Escalation">{data.detection.escalationEnabled ? "On" : "Off"}</KV>
                <KV label="Last run">{fmt(data.detection.lastRunAt)}</KV>
                <KV label="Last result">{data.detection.lastSummary ? `${data.detection.lastSummary.findings ?? 0} finding(s), ${data.detection.lastSummary.alertsCreated ?? 0} new alert(s)${data.detection.lastSummary.errors?.length ? `, ${data.detection.lastSummary.errors.length} error(s)` : ""}` : "No run yet"}</KV>
              </dl>
              <p className="mt-2 text-xs text-muted">Detection runs once a day and when you press Run now; it is not real-time monitoring.</p>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Backups and restore" action={can("soc:backups:view") ? <Link className="text-sm text-primary hover:underline" href="/admin/security-operations/backups">Details</Link> : undefined}>
              <dl>
                <KV label="Backup status"><StatusBadge status={data.backups.health} /></KV>
                <KV label="Last backup">{data.backups.lastBackup ? `${data.backups.lastBackup.code} · ${fmt(data.backups.lastBackup.startedAt)}` : "none yet"}</KV>
                <KV label="Last verified backup">{data.backups.lastVerified ? `${data.backups.lastVerified.code} · ${fmt(data.backups.lastVerified.startedAt)}` : "none yet"}</KV>
                <KV label="Restore proven">{data.restore.hasProof ? `Yes — ${fmt(data.restore.lastProven?.completedAt)}` : "No — no approved restore drill yet"}</KV>
                <KV label="Last restore drill">{data.restore.lastAttempt ? `${data.restore.lastAttempt.status} · ${fmt(data.restore.lastAttempt.at)}` : "none yet"}</KV>
              </dl>
              {data.backups.reasons.length > 0 && <ul className="mt-2 list-disc pl-5 text-sm text-muted">{data.backups.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
              <Source>BackupRun, RestoreTest, RestoreDrill</Source>
            </Card>
            <Card title="Disaster recovery" action={can("soc:dr:view") ? <Link className="text-sm text-primary hover:underline" href="/admin/security-operations/disaster-recovery">Details</Link> : undefined}>
              <Table head={["", "Configured (target)", "Measured"]}>
                <tr><td className="px-2 py-2">Recovery point (RPO)</td><td className="px-2 py-2">{minutesLabel(data.disasterRecovery.configured.rpoMinutes)}</td><td className="px-2 py-2">{minutesLabel(data.disasterRecovery.measured.rpoMinutes)} <span className="text-xs text-muted">({data.disasterRecovery.comparison.rpo.replace(/_/g, " ").toLowerCase()})</span></td></tr>
                <tr><td className="px-2 py-2">Recovery time (RTO)</td><td className="px-2 py-2">{minutesLabel(data.disasterRecovery.configured.rtoMinutes)}</td><td className="px-2 py-2">{minutesLabel(data.disasterRecovery.measured.rtoMinutes)} <span className="text-xs text-muted">({data.disasterRecovery.comparison.rto.replace(/_/g, " ").toLowerCase()})</span></td></tr>
              </Table>
              <p className="mt-2 text-sm text-muted">Plan: {data.disasterRecovery.planVersion ? `version ${data.disasterRecovery.planVersion} approved` : "no approved plan"} · Recovery tests {data.disasterRecovery.testsOverdue ? "overdue" : "on schedule"}</p>
              <p className="mt-1 text-xs text-muted">Targets are objectives, not guarantees. Measured figures come from real records and stay empty until there is evidence.</p>
            </Card>
          </div>

          <Card title="Security audit history" action={can("soc:audit:view") ? <Link className="text-sm text-primary hover:underline" href="/admin/security-operations/audit">Full log</Link> : undefined}>
            {data.recentAudit.length === 0 ? <EmptyState title="No security-operations changes recorded yet" /> : (
              <Table head={["Change", "By", "When"]}>
                {data.recentAudit.map((a) => <tr key={a.id}><td className="px-2 py-2">{a.action.replace(/^SOC_/, "").replace(/_/g, " ").toLowerCase()}</td><td className="px-2 py-2 text-muted">{a.adminId ?? "system"}</td><td className="px-2 py-2 text-muted">{fmt(a.createdAt)}</td></tr>)}
              </Table>
            )}
            <Source at={data.generatedAt}>AuditLog</Source>
          </Card>
        </>
      )}
    </div>
  );
}
