"use client";

import { Activity, Database, ShieldAlert, Server } from "lucide-react";
import { StatCard } from "@/components/admin/stat-card";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";
import { Card, KV, Loading, ErrorNote, StatusBadge, useApi, timeAgo } from "@/components/admin/system/shared";

interface HealthData {
  health: { status: string; timestamp: string; version: string; environment: string; checks: Record<string, { status: string; detail?: string; latencyMs?: number }> };
  application: { environment: string; version: string; commit: string | null; release: { code: string; status: string; deployedAt: string } | null; operationalState: string };
  database: { latencyMs: number | null; sizeMb: number; migrationsTracked: boolean; migrationsApplied: number; lastMigration: string | null; slowestRecent: Array<{ operation: string; table: string; route: string | null; maxMs: number }>; poolNote: string };
  storage: { tokenConfigured: boolean; files: { photos: number; documents: number; evidence: number }; totalMb: number; storageErrors24h: number };
  payments: { rolloutStage: string; activeProvider: string; environmentSafety: { ok: boolean; detail: string }; lastSuccessfulPaymentAt: string | null; lastFailedPaymentAt: string | null; pendingPaymentsCount: number; lastSuccessfulWebhookAt: string | null; lastFailedWebhookAt: string | null };
  communications: { email: boolean; sms: boolean; whatsappEnabled: boolean; failedDeliveries24h: Array<{ channel: string; count: number }> };
  jobs: { counts: Record<string, number>; tick: { lastCompletedAt: string | null; lastStatus: string | null; consecutiveFailures: number } | null };
  security: { failedAdminLogins24h: number; permissionViolations24h: number; webhookFailures24h: number };
  errors: { openLastHour: Record<string, number> };
  config: { appEnv: string; issues: Array<{ severity: string; key: string; message: string }>; present: Record<string, { present: boolean }> };
}

export function HealthOverview() {
  const { data, error, loading, reload } = useApi<HealthData>("/api/admin/system/health");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;
  const { health, application: app, database: db, storage, payments, communications: comms, jobs, security, errors, config } = data;
  const openErrors = Object.values(errors.openLastHour).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">Snapshot {formatDateTime(health.timestamp)} · secrets are never displayed.</p>
        <Button size="sm" variant="outline" onClick={reload}>Refresh</Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={Activity} label="Overall" value={health.status.toUpperCase()} accent={health.status === "ok" ? "success" : health.status === "down" ? "danger" : "warning"} />
        <StatCard icon={Server} label="Operational state" value={app.operationalState} accent={app.operationalState === "NORMAL" ? "success" : "warning"} />
        <StatCard icon={Database} label="DB latency" value={db.latencyMs != null ? `${db.latencyMs} ms` : "—"} accent={db.latencyMs != null && db.latencyMs > 1000 ? "warning" : "success"} />
        <StatCard icon={ShieldAlert} label="Open errors (1 h)" value={openErrors} accent={openErrors > 0 ? "warning" : "success"} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Application">
          <dl>
            <KV label="Environment">{app.environment}</KV>
            <KV label="Version">{health.version}</KV>
            <KV label="Release">{app.release ? <span>{app.release.code} <StatusBadge status={app.release.status} /></span> : "not recorded (local/dev)"}</KV>
            <KV label="Config issues">{config.issues.filter((i) => i.severity === "CRITICAL").length} critical · {config.issues.filter((i) => i.severity === "BLOCKER").length} blockers</KV>
          </dl>
        </Card>

        <Card title="Database">
          <dl>
            <KV label="Connection"><StatusBadge status={health.checks.database?.status} /></KV>
            <KV label="Size">{db.sizeMb} MB</KV>
            <KV label="Migration history">{db.migrationsTracked ? `${db.migrationsApplied} applied (last: ${db.lastMigration ?? "—"})` : "not tracked (db push)"}</KV>
            <KV label="Slowest recent">{db.slowestRecent[0] ? `${db.slowestRecent[0].operation} ${db.slowestRecent[0].table} · ${db.slowestRecent[0].maxMs} ms` : "none in 24 h"}</KV>
          </dl>
          <p className="mt-2 text-xs text-muted">{db.poolNote}</p>
        </Card>

        <Card title="Storage">
          <dl>
            <KV label="Token configured"><StatusBadge status={storage.tokenConfigured ? "PASS" : "BLOCKED"} /></KV>
            <KV label="Files">{storage.files.photos} photos · {storage.files.documents} documents · {storage.files.evidence} evidence</KV>
            <KV label="Total size">{storage.totalMb} MB</KV>
            <KV label="Storage errors (24 h)">{storage.storageErrors24h}</KV>
          </dl>
        </Card>

        <Card title="Payments">
          <dl>
            <KV label="Provider / stage">{payments.activeProvider} · {payments.rolloutStage}</KV>
            <KV label="Environment safety"><StatusBadge status={payments.environmentSafety.ok ? "PASS" : "BLOCKED"} /></KV>
            <KV label="Pending payments">{payments.pendingPaymentsCount}</KV>
            <KV label="Last successful payment">{timeAgo(payments.lastSuccessfulPaymentAt)}</KV>
            <KV label="Webhook failures (24 h)">{security.webhookFailures24h}</KV>
          </dl>
        </Card>

        <Card title="Communications">
          <dl>
            <KV label="Email"><StatusBadge status={comms.email ? "PASS" : "not_configured"} /></KV>
            <KV label="SMS"><StatusBadge status={comms.sms ? "PASS" : "not_configured"} /></KV>
            <KV label="WhatsApp"><StatusBadge status={comms.whatsappEnabled ? "PASS" : "not_configured"} /></KV>
            <KV label="Failed deliveries (24 h)">{comms.failedDeliveries24h.length ? comms.failedDeliveries24h.map((c) => `${c.channel}: ${c.count}`).join(", ") : "none"}</KV>
          </dl>
          {!comms.email && <p className="mt-2 text-xs text-muted">No email provider is configured — messages (including admin OTP codes) are only written to the server log.</p>}
        </Card>

        <Card title="Background jobs">
          <dl>
            {["PENDING", "RUNNING", "RETRYING", "FAILED", "DEAD_LETTER", "COMPLETED"].map((s) => (
              <KV key={s} label={s.replace("_", " ")}>{jobs.counts[s] ?? 0}</KV>
            ))}
            <KV label="Daily tick">{jobs.tick ? <span>{timeAgo(jobs.tick.lastCompletedAt)} <StatusBadge status={jobs.tick.lastStatus} /></span> : "never ran"}</KV>
          </dl>
        </Card>

        <Card title="Security (24 h)" className="lg:col-span-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <KV label="Failed admin logins">{security.failedAdminLogins24h}</KV>
            <KV label="Denied / unauthenticated admin requests">{security.permissionViolations24h}</KV>
            <KV label="Payment webhook failures">{security.webhookFailures24h}</KV>
          </div>
        </Card>
      </div>

      <Card title="Dependency checks">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {Object.entries(health.checks).map(([name, c]) => (
                <tr key={name} className="border-b border-border last:border-0">
                  <td className="py-2 pr-3 font-medium">{name.replace(/_/g, " ")}</td>
                  <td className="py-2 pr-3"><StatusBadge status={c.status} /></td>
                  <td className="py-2 text-muted">{c.detail ?? ""}{c.latencyMs != null ? ` (${c.latencyMs} ms)` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {config.issues.length > 0 && (
        <Card title="Configuration issues">
          <ul className="space-y-1.5 text-sm">
            {config.issues.filter((i) => i.severity !== "INFO").map((i) => (
              <li key={`${i.key}-${i.message}`} className="flex items-start gap-2"><StatusBadge status={i.severity === "BLOCKER" ? "WARN" : i.severity} /><span><span className="font-mono text-xs">{i.key}</span> — {i.message}</span></li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
