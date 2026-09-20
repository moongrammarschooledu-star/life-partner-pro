"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/utils";
import { Card, KV, Loading, ErrorNote, StatusBadge, SensitiveActionDialog, useApi, callApi } from "@/components/admin/system/shared";

interface Control {
  operationalState: string; operationalStateReason: string | null;
  maintenanceMode: string; maintenanceStartsAt: string | null; maintenanceEndsAt: string | null; maintenanceMessage: string | null;
  emergencyPaymentsDisabled: boolean; emergencyRegistrationsDisabled: boolean; emergencyProfileSubmissionsDisabled: boolean; emergencyMatchingDisabled: boolean;
  emergencyProposalsDisabled: boolean; emergencyNotificationsDisabled: boolean; emergencyUploadsDisabled: boolean; emergencyPublicAccessDisabled: boolean;
  rpoMinutes: number; rtoMinutes: number; slowQueryThresholdMs: number; apiLatencyWarnMs: number; errorRateWarnPerHour: number; failedLoginSpikeThreshold: number;
  paymentFailureSpikeThreshold: number; webhookFailureSpikeThreshold: number; queueBacklogThreshold: number; permissionViolationThreshold: number;
  dbStorageLimitMb: number | null; fileStorageLimitMb: number | null; capacityWarnPercent: number; monitoringPeriodHours: number; evidenceMaxAgeDays: number;
  backupsEnabled: boolean; backupDailyKeep: number; backupWeeklyKeep: number; backupMonthlyKeep: number; backupStaleAfterHours: number; restoreTestStaleAfterDays: number;
  adminSessionMaxHours: number;
}

async function save(section: string, values: Record<string, unknown>, extra: { reason?: string; stepUpToken?: string } = {}) {
  return callApi<Control>("/api/admin/system/control", "PATCH", { section, values, ...extra });
}

// ---------------------------------------------------------------- Environment
export function EnvironmentPanel() {
  const { data, error, loading } = useApi<{ config: { appEnv: string; issues: Array<{ severity: string; key: string; message: string }>; present: Record<string, { present: boolean }> }; application: { version: string; commit: string | null } }>("/api/admin/system/health");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;
  const { config } = data;
  return (
    <div className="space-y-4">
      <Card title={`Environment: ${config.appEnv}`}>
        <p className="mb-3 text-xs text-muted">Only whether a variable is set is shown — values are never displayed, logged or returned by any API. Environment variables are changed in the hosting provider (Vercel), not here.</p>
        <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
          {Object.entries(config.present).map(([key, v]) => (
            <div key={key} className="flex items-center justify-between border-b border-border py-1.5 text-sm last:border-0"><span className="font-mono text-xs">{key}</span><StatusBadge status={v.present ? "PASS" : "not_configured"} /></div>
          ))}
        </div>
      </Card>
      <Card title="Configuration issues">
        {config.issues.length === 0 ? <p className="text-sm text-muted">None.</p> : (
          <ul className="space-y-1.5 text-sm">
            {config.issues.map((i) => <li key={`${i.key}${i.message}`} className="flex items-start gap-2"><StatusBadge status={i.severity === "BLOCKER" ? "BLOCKED" : i.severity === "INFO" ? "unknown" : i.severity} /><span><span className="font-mono text-xs">{i.key}</span> — {i.message}</span></li>)}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- Feature flags
export function FlagsPanel({ canManage }: { canManage: boolean }) {
  const { show } = useToast();
  const { data, error, loading, reload } = useApi<{ items: Array<{ key: string; description: string; sensitive: boolean; enabled: boolean; managedElsewhere?: string }>; propagationNote: string }>("/api/admin/system/flags");
  const [pending, setPending] = useState<{ key: string; enabled: boolean } | null>(null);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;
  return (
    <Card title="Feature flags">
      <p className="mb-3 text-xs text-muted">Flags are enforced on the server for every real consumer. {data.propagationNote}</p>
      <div className="divide-y divide-border">
        {data.items.map((f) => (
          <div key={f.key} className="flex items-center justify-between gap-3 py-2.5">
            <div>
              <div className="font-mono text-sm">{f.key} {f.sensitive && <span className="ml-1 rounded bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning">sensitive</span>}</div>
              <div className="text-xs text-muted">{f.description}{f.managedElsewhere ? ` — managed in ${f.managedElsewhere}` : ""}</div>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={f.enabled ? "PASS" : "BLOCKED"} />
              {canManage && !f.managedElsewhere && <Button size="sm" variant="outline" onClick={() => setPending({ key: f.key, enabled: !f.enabled })}>{f.enabled ? "Disable" : "Enable"}</Button>}
            </div>
          </div>
        ))}
      </div>
      <SensitiveActionDialog
        open={pending != null}
        title={pending ? `${pending.enabled ? "Enable" : "Disable"} ${pending.key}` : "Feature flag"}
        description="The change is enforced server-side and recorded in the audit log with the previous and new value."
        danger={pending ? !pending.enabled : false}
        onCancel={() => setPending(null)}
        onConfirm={async ({ reason }) => {
          if (!pending) return null;
          const res = await callApi("/api/admin/system/flags", "PATCH", { key: pending.key, enabled: pending.enabled, reason });
          if (!res.ok) return res.data.error ?? "Could not change the flag";
          show("Flag updated", "success");
          reload();
          return null;
        }}
      />
    </Card>
  );
}

// ---------------------------------------------------------------- Maintenance & state
function toLocalInput(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function MaintenancePanel({ canManage }: { canManage: boolean }) {
  const { show } = useToast();
  const { data, error, loading, reload } = useApi<Control>("/api/admin/system/control");
  const [mode, setMode] = useState<string | null>(null);
  const [starts, setStarts] = useState<string | null>(null);
  const [ends, setEnds] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [state, setState] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"state" | "maintenance" | null>(null);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;

  const m = mode ?? data.maintenanceMode;
  const st = state ?? data.operationalState;

  return (
    <div className="space-y-4">
      <Card title="Operational state" action={<StatusBadge status={data.operationalState} />}>
        <p className="mb-3 text-xs text-muted">NORMAL · DEGRADED · MAINTENANCE · RECOVERY · EMERGENCY. MAINTENANCE blocks public traffic; EMERGENCY closes every public switch at once. Admin console, webhooks, cron and health checks always stay reachable.{data.operationalStateReason ? ` Current reason: ${data.operationalStateReason}` : ""}</p>
        <div className="flex flex-wrap items-end gap-2">
          <Select value={st} onChange={(e) => setState(e.target.value)} disabled={!canManage} className="w-48" aria-label="Operational state">{["NORMAL", "DEGRADED", "MAINTENANCE", "RECOVERY", "EMERGENCY"].map((s) => <option key={s}>{s}</option>)}</Select>
          {canManage && <Button size="sm" variant={st === "EMERGENCY" ? "danger" : "primary"} disabled={st === data.operationalState} onClick={() => setDialog("state")}>Change state</Button>}
        </div>
      </Card>

      <Card title="Maintenance mode" action={<StatusBadge status={data.maintenanceMode === "OFF" ? "PASS" : "MAINTENANCE"} />}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Mode" htmlFor="mm-mode"><Select id="mm-mode" value={m} onChange={(e) => setMode(e.target.value)} disabled={!canManage}><option>OFF</option><option>ON</option><option>SCHEDULED</option></Select></Field>
          <div />
          <Field label="Window starts (scheduled)" htmlFor="mm-start"><Input id="mm-start" type="datetime-local" value={starts ?? toLocalInput(data.maintenanceStartsAt)} onChange={(e) => setStarts(e.target.value)} disabled={!canManage} /></Field>
          <Field label="Window ends (optional)" htmlFor="mm-end"><Input id="mm-end" type="datetime-local" value={ends ?? toLocalInput(data.maintenanceEndsAt)} onChange={(e) => setEnds(e.target.value)} disabled={!canManage} /></Field>
          <Field label="Public message (blank = default)" htmlFor="mm-msg" className="sm:col-span-2"><Textarea id="mm-msg" value={message ?? data.maintenanceMessage ?? ""} onChange={(e) => setMessage(e.target.value)} disabled={!canManage} placeholder="Life Partner Pro is temporarily undergoing maintenance. Please try again later." /></Field>
        </div>
        <p className="mt-2 text-xs text-muted">While active: public users see a neutral maintenance page; admins, payment webhooks and cron keep working; payments already in progress are not interrupted; nothing is deleted.</p>
        {canManage && <div className="mt-3 flex justify-end"><Button size="sm" onClick={() => setDialog("maintenance")}>Apply maintenance settings</Button></div>}
      </Card>

      <SensitiveActionDialog
        open={dialog === "state"}
        title={`Change operational state to ${st}`}
        description="High-risk change: requires your password and a reason. It is recorded in the audit log."
        danger={st === "EMERGENCY" || st === "MAINTENANCE"}
        onCancel={() => setDialog(null)}
        onConfirm={async ({ reason, stepUpToken }) => {
          const res = await save("state", { operationalState: st, operationalStateReason: reason }, { reason, stepUpToken });
          if (!res.ok) return res.data.error ?? "Could not change the state";
          show("Operational state updated", "success");
          setState(null); reload();
          return null;
        }}
      />
      <SensitiveActionDialog
        open={dialog === "maintenance"}
        title="Apply maintenance settings"
        description={m === "OFF" ? "Turning maintenance off restores public access." : "This takes the public site offline for visitors (admins stay available)."}
        danger={m !== "OFF"}
        requireReason={m !== "OFF"}
        onCancel={() => setDialog(null)}
        onConfirm={async ({ reason, stepUpToken }) => {
          const values: Record<string, unknown> = { maintenanceMode: m, maintenanceMessage: (message ?? data.maintenanceMessage ?? "").trim() || null };
          const s = starts ?? toLocalInput(data.maintenanceStartsAt);
          const e = ends ?? toLocalInput(data.maintenanceEndsAt);
          values.maintenanceStartsAt = s ? new Date(s).toISOString() : null;
          values.maintenanceEndsAt = e ? new Date(e).toISOString() : null;
          const res = await save("maintenance", values, { reason, stepUpToken });
          if (!res.ok) return res.data.error ?? "Could not apply";
          show("Maintenance settings applied", "success");
          setMode(null); setStarts(null); setEnds(null); setMessage(null); reload();
          return null;
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------- Emergency switches
const SWITCHES: Array<{ field: keyof Control; label: string; effect: string }> = [
  { field: "emergencyPaymentsDisabled", label: "Payments", effect: "Blocks NEW checkout sessions (existing subscriptions, invoices and refunds unaffected)." },
  { field: "emergencyRegistrationsDisabled", label: "Registrations", effect: "New applicant registrations return a neutral 503." },
  { field: "emergencyProfileSubmissionsDisabled", label: "Profile submissions", effect: "Registration and profile-update submissions are refused." },
  { field: "emergencyMatchingDisabled", label: "Matching", effect: "Admin matching runs and match creation are refused." },
  { field: "emergencyProposalsDisabled", label: "Proposals", effect: "Creating proposals is refused." },
  { field: "emergencyNotificationsDisabled", label: "Notifications", effect: "External delivery pauses; failed rows are kept for retry." },
  { field: "emergencyUploadsDisabled", label: "File uploads", effect: "Photo, document and evidence uploads are refused." },
  { field: "emergencyPublicAccessDisabled", label: "Public application access", effect: "The whole public site shows the neutral page. Admin console stays up." },
];

export function EmergencyPanel({ canManage }: { canManage: boolean }) {
  const { show } = useToast();
  const { data, error, loading, reload } = useApi<Control>("/api/admin/system/control");
  const [pending, setPending] = useState<{ field: keyof Control; label: string; value: boolean } | null>(null);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;
  return (
    <Card title="Emergency kill switches">
      <p className="mb-3 text-xs text-muted">For genuine emergencies only — prefer a feature flag or normal maintenance mode. Every change needs a reason and your password and is recorded with the previous and new value. Switches are enforced on the server (not UI-only) and neutral messages are shown to the public.</p>
      <div className="divide-y divide-border">
        {SWITCHES.map((s) => {
          const on = Boolean(data[s.field]);
          return (
            <div key={s.field} className="flex items-center justify-between gap-3 py-2.5">
              <div><div className="text-sm font-medium">{s.label}</div><div className="text-xs text-muted">{s.effect}</div></div>
              <div className="flex items-center gap-2">
                <StatusBadge status={on ? "EMERGENCY" : "NORMAL"} />
                {canManage && <Button size="sm" variant={on ? "outline" : "danger"} onClick={() => setPending({ field: s.field, label: s.label, value: !on })}>{on ? "Re-open" : "Shut down"}</Button>}
              </div>
            </div>
          );
        })}
      </div>
      <SensitiveActionDialog
        open={pending != null}
        title={pending ? `${pending.value ? "Shut down" : "Re-open"}: ${pending.label}` : "Emergency switch"}
        description={pending?.value ? "This immediately stops the feature for the public. Confirm only if this is a real emergency." : "This restores the feature."}
        danger={pending?.value}
        onCancel={() => setPending(null)}
        onConfirm={async ({ reason, stepUpToken }) => {
          if (!pending) return null;
          const res = await save("emergency", { [pending.field]: pending.value }, { reason, stepUpToken });
          if (!res.ok) return res.data.error ?? "Could not change the switch";
          show("Switch updated", "success");
          reload();
          return null;
        }}
      />
    </Card>
  );
}

// ---------------------------------------------------------------- Numeric settings (monitoring / backup / session)
type NumField = { field: keyof Control; label: string; hint?: string; nullable?: boolean };

function NumericForm({ title, section, fields, canManage, requireReauth, description }: { title: string; section: "thresholds" | "backup" | "session"; fields: NumField[]; canManage: boolean; requireReauth?: boolean; description?: string }) {
  const { show } = useToast();
  const { data, error, loading, reload } = useApi<Control>("/api/admin/system/control");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;

  const value = (f: NumField) => draft[f.field as string] ?? (data[f.field] == null ? "" : String(data[f.field]));
  function build(): Record<string, unknown> | string {
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = draft[f.field as string];
      if (raw === undefined) continue;
      if (raw.trim() === "") { if (f.nullable) { out[f.field as string] = null; continue; } return `${f.label} is required.`; }
      const n = Number(raw);
      if (!Number.isFinite(n)) return `${f.label} must be a number.`;
      out[f.field as string] = n;
    }
    return Object.keys(out).length ? out : "Nothing changed.";
  }
  async function submit(extra: { reason?: string; stepUpToken?: string }) {
    const values = build();
    if (typeof values === "string") return values;
    const res = await save(section, values, extra);
    if (!res.ok) return res.data.error ?? "Could not save";
    show("Saved", "success");
    setDraft({}); reload();
    return null;
  }

  return (
    <Card title={title}>
      {description && <p className="mb-3 text-xs text-muted">{description}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((f) => (
          <Field key={f.field as string} label={f.label} hint={f.hint} htmlFor={`f-${f.field as string}`}>
            <Input id={`f-${f.field as string}`} inputMode="numeric" value={value(f)} onChange={(e) => setDraft((d) => ({ ...d, [f.field as string]: e.target.value }))} disabled={!canManage} placeholder={f.nullable ? "not set" : undefined} />
          </Field>
        ))}
      </div>
      {canManage && (
        <div className="mt-3 flex items-center justify-end gap-3">
          {section === "backup" && <BackupEnabledToggle enabled={data.backupsEnabled} onDone={reload} />}
          <Button size="sm" disabled={Object.keys(draft).length === 0} onClick={async () => { if (requireReauth) setOpen(true); else { const err = await submit({}); if (err) show(err, "error"); } }}>Save changes</Button>
        </div>
      )}
      <SensitiveActionDialog
        open={open}
        title={`Save ${title.toLowerCase()}`}
        description="Security-related setting: requires your password and a reason."
        onCancel={() => setOpen(false)}
        onConfirm={({ reason, stepUpToken }) => submit({ reason, stepUpToken })}
      />
    </Card>
  );
}

function BackupEnabledToggle({ enabled, onDone }: { enabled: boolean; onDone: () => void }) {
  const { show } = useToast();
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" className="h-4 w-4 accent-primary" checked={enabled} onChange={async (e) => { const r = await save("backup", { backupsEnabled: e.target.checked }); if (r.ok) { show("Saved", "success"); onDone(); } else show(r.data.error ?? "Could not save", "error"); }} />
      Scheduled backups enabled
    </label>
  );
}

export function MonitoringPanel({ canManage }: { canManage: boolean }) {
  return (
    <div className="space-y-4">
      <NumericForm
        title="Monitoring thresholds & capacity"
        section="thresholds"
        canManage={canManage}
        description="Warning thresholds are configurable and never a performance or capacity guarantee. Alerts fire when a threshold is reached (evaluated by the daily tick and on demand)."
        fields={[
          { field: "slowQueryThresholdMs", label: "Slow query threshold (ms)" },
          { field: "apiLatencyWarnMs", label: "API latency warning (ms)" },
          { field: "errorRateWarnPerHour", label: "Server errors per hour" },
          { field: "failedLoginSpikeThreshold", label: "Failed admin logins / hour" },
          { field: "paymentFailureSpikeThreshold", label: "Payment failures / 24 h" },
          { field: "webhookFailureSpikeThreshold", label: "Webhook failures / 24 h" },
          { field: "queueBacklogThreshold", label: "Overdue job backlog" },
          { field: "permissionViolationThreshold", label: "Denied admin requests / hour" },
          { field: "dbStorageLimitMb", label: "Database storage limit (MB)", hint: "Your plan's limit; blank = no capacity alert", nullable: true },
          { field: "fileStorageLimitMb", label: "File storage limit (MB)", hint: "Blank = no capacity alert", nullable: true },
          { field: "capacityWarnPercent", label: "Capacity warning at (%)" },
          { field: "monitoringPeriodHours", label: "Post-release monitoring (hours)" },
          { field: "evidenceMaxAgeDays", label: "CI evidence max age (days)" },
          { field: "rpoMinutes", label: "Recovery Point Objective (min)", hint: "Target only" },
          { field: "rtoMinutes", label: "Recovery Time Objective (min)", hint: "Target only" },
        ]}
      />
      <NumericForm
        title="Admin session security"
        section="session"
        canManage={canManage}
        requireReauth
        description="Sessions are validated against a server-side record; an expired or revoked session is rejected by the admin layout and every admin API. Applies to sign-ins from now on."
        fields={[{ field: "adminSessionMaxHours", label: "Admin session lifetime (hours)" }]}
      />
    </div>
  );
}

export function BackupPolicyPanel({ canManage }: { canManage: boolean }) {
  return (
    <NumericForm
      title="Backup & retention policy"
      section="backup"
      canManage={canManage}
      description="Grandfather-father-son retention. Counts are configurable — no legal retention period is hard-coded; set them to match this deployment's operational/legal requirements. The newest backup and newest restore-verified backup are never pruned."
      fields={[
        { field: "backupDailyKeep", label: "Daily backups to keep" },
        { field: "backupWeeklyKeep", label: "Weekly (Sunday) backups to keep" },
        { field: "backupMonthlyKeep", label: "Monthly (1st) backups to keep" },
        { field: "backupStaleAfterHours", label: "Alert if no backup for (hours)" },
        { field: "restoreTestStaleAfterDays", label: "Alert if no restore test for (days)" },
      ]}
    />
  );
}

// ---------------------------------------------------------------- Deployment
export function DeploymentPanel() {
  const { data, error, loading } = useApi<{ application: { environment: string; version: string; commit: string | null; release: { code: string; status: string; deployedAt: string } | null }; database: { migrationsTracked: boolean; migrationsApplied: number; lastMigration: string | null } }>("/api/admin/system/health");
  const releases = useApi<{ items: Array<{ id: string; releaseCode: string; version: string; status: string; deployedAt: string; approvedAt: string | null; rollbackTarget: { releaseCode: string } | null }> }>("/api/admin/system/releases");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;
  return (
    <div className="space-y-4">
      <Card title="Deployment information">
        <dl>
          <KV label="Environment">{data.application.environment}</KV>
          <KV label="Version">{data.application.version}{data.application.commit ? `+${data.application.commit}` : ""}</KV>
          <KV label="Current release">{data.application.release ? <span>{data.application.release.code} <StatusBadge status={data.application.release.status} /></span> : "not recorded (local development)"}</KV>
          <KV label="Migration history">{data.database.migrationsTracked ? `${data.database.migrationsApplied} applied (last: ${data.database.lastMigration ?? "—"})` : "not tracked — schema managed by db push"}</KV>
        </dl>
      </Card>
      <Card title="Recent releases">
        {releases.data?.items.length ? (
          <ul className="space-y-1.5 text-sm">
            {releases.data.items.map((r) => <li key={r.id} className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs">{r.releaseCode}</span><StatusBadge status={r.status} /><span>{r.version}</span><span className="text-muted">{formatDateTime(r.deployedAt)}</span>{r.approvedAt && <span className="text-xs text-success">approved</span>}</li>)}
          </ul>
        ) : <p className="text-sm text-muted">No releases recorded yet — they are registered automatically the first time a deployed build starts (Vercel deployments only).</p>}
        <p className="mt-2 text-xs text-muted">Approval, rollback assessment and post-deploy verification live under Production Readiness → Releases.</p>
      </Card>
    </div>
  );
}
