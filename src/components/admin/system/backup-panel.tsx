"use client";

import { useState } from "react";
import { Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/utils";
import { Card, KV, Loading, ErrorNote, StatusBadge, SensitiveActionDialog, useApi, callApi, formatBytes, timeAgo } from "@/components/admin/system/shared";

interface Check { name: string; status: string; detail: string }
interface Run { id: string; backupCode: string; type: string; trigger: string; status: string; retentionClass: string; startedAt: string; completedAt: string | null; sizeBytes: number | null; separateStore: boolean; verifiedAt: string | null; verificationStatus: string | null; failureReason: string | null; prunedAt: string | null; manifest: { totalRows?: number; copiedThisRun?: number; remaining?: number } | null }
interface RestoreRequest { id: string; status: string; reason: string; targetLabel: string; requestedAt: string; requestedById: string; approvedById: string | null; backup: { backupCode: string } }
interface Data {
  summary: { lastSuccessful: { backupCode: string; at: string; sizeBytes: number | null; verification: string | null; retentionClass: string } | null; lastRestoreTest: { at: string; status: string; backupCode: string } | null; failedBackupCount: number; nextScheduledBackup: string | null; fileMirror: { sources: number; mirrored: number } };
  configuration: { encryptionKeyConfigured: boolean; separateStorageConfigured: boolean; backupsEnabled: boolean; policy: { daily: number; weekly: number; monthly: number }; rpoMinutes: number; rtoMinutes: number };
  runs: Run[];
  restoreRequests: RestoreRequest[];
}

export function BackupPanel({ canTrigger, canRestore, adminId }: { canTrigger: boolean; canRestore: boolean; adminId: string }) {
  const { show } = useToast();
  const { data, error, loading, reload } = useApi<Data>("/api/admin/system/backups");
  const [busy, setBusy] = useState<string | null>(null);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreBackupId, setRestoreBackupId] = useState("");
  const [targetLabel, setTargetLabel] = useState("");
  const [act, setAct] = useState<{ id: string; action: "approve" | "reject" | "executed" | "cancel" } | null>(null);
  const [validateOpen, setValidateOpen] = useState(false);
  const [validation, setValidation] = useState<{ passed: boolean; results: Check[] } | null>(null);

  async function run(action: string, backupId?: string) {
    setBusy(action + (backupId ?? ""));
    setChecks(null);
    try {
      const res = await callApi<{ outcome?: { status: string; message?: string }; verification?: { passed: boolean; checks: Check[] } | null; passed?: boolean; checks?: Check[]; pruned?: number }>("/api/admin/system/backups", "POST", { action, backupId });
      if (!res.ok) {
        show(res.data.error ?? "Action failed", "error");
        return;
      }
      const d = res.data;
      if (d.verification?.checks) setChecks(d.verification.checks);
      if (d.checks) setChecks(d.checks);
      const failed = d.outcome?.status === "FAILED" || d.passed === false;
      show(d.outcome?.status === "FAILED" ? `Failed: ${d.outcome.message ?? ""}` : d.pruned != null ? `${d.pruned} pruned` : action === "verify" ? (d.passed ? "Restore verification PASSED" : "Restore verification FAILED") : "Done", failed ? "error" : "success");
      reload();
    } finally {
      setBusy(null);
    }
  }

  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;
  const { summary, configuration: cfg } = data;
  const verified = data.runs.filter((r) => r.type === "DATABASE" && r.status === "COMPLETED" && !r.prunedAt && r.verificationStatus === "PASSED");

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Status">
          <dl>
            <KV label="Last successful backup">{summary.lastSuccessful ? <span>{summary.lastSuccessful.backupCode} · {timeAgo(summary.lastSuccessful.at)} <StatusBadge status={summary.lastSuccessful.verification} /></span> : "none"}</KV>
            <KV label="Backup size">{formatBytes(summary.lastSuccessful?.sizeBytes)}</KV>
            <KV label="Backup timestamp">{summary.lastSuccessful ? formatDateTime(summary.lastSuccessful.at) : "—"}</KV>
            <KV label="Last restore test">{summary.lastRestoreTest ? <span>{timeAgo(summary.lastRestoreTest.at)} <StatusBadge status={summary.lastRestoreTest.status} /></span> : "never"}</KV>
            <KV label="Failed backups on record">{summary.failedBackupCount}</KV>
            <KV label="Next scheduled backup">{summary.nextScheduledBackup ? formatDateTime(summary.nextScheduledBackup) : "backups disabled"}</KV>
            <KV label="File mirror">{summary.fileMirror.mirrored}/{summary.fileMirror.sources} private files copied</KV>
          </dl>
        </Card>
        <Card title="Configuration (no secrets shown)">
          <dl>
            <KV label="Encryption key"><StatusBadge status={cfg.encryptionKeyConfigured ? "PASS" : "BLOCKED"} /></KV>
            <KV label="Separate backup storage"><StatusBadge status={cfg.separateStorageConfigured ? "PASS" : "WARN"} /></KV>
            <KV label="Retention (daily / weekly / monthly)">{cfg.policy.daily} / {cfg.policy.weekly} / {cfg.policy.monthly}</KV>
            <KV label="RPO / RTO targets">{cfg.rpoMinutes} min / {cfg.rtoMinutes} min <span className="text-xs text-muted">(targets, not guarantees)</span></KV>
          </dl>
          {!cfg.encryptionKeyConfigured && <p className="mt-2 text-xs text-warning">Set BACKUP_ENCRYPTION_KEY (32+ characters) in the environment before creating backups.</p>}
        </Card>
      </div>

      {canTrigger && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy !== null} onClick={() => run("backup_db")}>{busy === "backup_db" ? "Backing up…" : "Backup database now"}</Button>
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run("backup_files")}>{busy === "backup_files" ? "Copying…" : "Mirror private files now"}</Button>
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run("prune")}>Apply retention</Button>
        </div>
      )}

      {checks && (
        <Card title="Verification result">
          <ul className="space-y-1 text-sm">
            {checks.map((c, i) => <li key={i} className="flex items-start gap-2"><StatusBadge status={c.status} /><span><b>{c.name}</b> — {c.detail}</span></li>)}
          </ul>
        </Card>
      )}

      <Card title="Backups">
        {data.runs.length === 0 ? <EmptyState icon={Database} title="No backups yet" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted"><th className="p-2">Code</th><th className="p-2">Type</th><th className="p-2">When</th><th className="p-2">Status</th><th className="p-2">Size</th><th className="p-2">Restore-verified</th><th className="p-2" /></tr></thead>
              <tbody>
                {data.runs.map((r) => (
                  <tr key={r.id} className="border-b border-border align-top last:border-0">
                    <td className="p-2 font-mono text-xs">{r.backupCode}<div className="text-muted">{r.trigger} · {r.retentionClass}</div></td>
                    <td className="p-2">{r.type}</td>
                    <td className="p-2 text-muted">{formatDateTime(r.startedAt)}</td>
                    <td className="p-2"><StatusBadge status={r.prunedAt ? "CANCELLED" : r.status} />{r.failureReason && <div className="mt-1 max-w-xs text-xs text-danger">{r.failureReason}</div>}{r.type === "FILES" && r.manifest && <div className="text-xs text-muted">{r.manifest.copiedThisRun ?? 0} copied · {r.manifest.remaining ?? 0} remaining</div>}</td>
                    <td className="p-2">{formatBytes(r.sizeBytes)}</td>
                    <td className="p-2">{r.type === "DATABASE" ? <StatusBadge status={r.verificationStatus} /> : "—"}</td>
                    <td className="p-2">{canTrigger && r.type === "DATABASE" && r.status === "COMPLETED" && !r.prunedAt && <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run("verify", r.id)}>Verify restore</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Restore requests" action={canRestore && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setValidateOpen(true)}>Post-restore validation</Button><Button size="sm" variant="danger" onClick={() => setRestoreOpen(true)} disabled={verified.length === 0}>Request restore</Button></div>}>
        <p className="mb-3 text-xs text-muted">A restore never happens inside the application. A request needs a restore-verified backup, a typed confirmation, your password and a written reason; a <b>different</b> administrator must approve; an operator then runs <code>scripts/restore-backup.ts</code> and the request is marked executed.</p>
        {data.restoreRequests.length === 0 ? <p className="text-sm text-muted">No restore requests.</p> : (
          <div className="space-y-2">
            {data.restoreRequests.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
                <div><StatusBadge status={r.status} /> <span className="font-mono text-xs">{r.backup.backupCode}</span> → {r.targetLabel}<div className="text-xs text-muted">{r.reason} · {formatDateTime(r.requestedAt)}</div></div>
                {canRestore && (
                  <div className="flex gap-2">
                    {r.status === "PENDING" && r.requestedById !== adminId && <Button size="sm" onClick={() => setAct({ id: r.id, action: "approve" })}>Approve</Button>}
                    {r.status === "PENDING" && <Button size="sm" variant="outline" onClick={() => setAct({ id: r.id, action: "reject" })}>Reject</Button>}
                    {r.status === "APPROVED" && <Button size="sm" variant="outline" onClick={() => setAct({ id: r.id, action: "executed" })}>Mark executed</Button>}
                    {(r.status === "PENDING" || r.status === "APPROVED") && <Button size="sm" variant="outline" onClick={() => setAct({ id: r.id, action: "cancel" })}>Cancel</Button>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {validation && (
        <Card title={`Post-restore validation — ${validation.passed ? "PASSED" : "FAILED"}`}>
          <ul className="space-y-1 text-sm">{validation.results.map((c, i) => <li key={i} className="flex items-start gap-2"><StatusBadge status={c.status} /><span><b>{c.name}</b> — {c.detail}</span></li>)}</ul>
        </Card>
      )}

      <SensitiveActionDialog
        open={restoreOpen}
        title="Request a restore"
        description="This records an authorization request only — it does not change any data. Choose a verified backup, describe the target, and type the confirmation phrase 'RESTORE <backup code>'."
        confirmLabel="Submit request"
        danger
        extraField={{ label: "Confirmation phrase", placeholder: "RESTORE LPP-BKP-000001" }}
        onCancel={() => setRestoreOpen(false)}
        onConfirm={async ({ reason, stepUpToken, extra }) => {
          if (!restoreBackupId) return "Choose a backup first.";
          if (!targetLabel.trim()) return "Describe the restore target first.";
          const res = await callApi("/api/admin/system/restore-requests", "POST", { backupId: restoreBackupId, reason, targetLabel, typedConfirmation: extra, stepUpToken });
          if (!res.ok) return res.data.error ?? "Could not create the request";
          show("Restore request created — system moved to RECOVERY", "success");
          reload();
          return null;
        }}
      >
        <Select value={restoreBackupId} onChange={(e) => setRestoreBackupId(e.target.value)} aria-label="Backup">
          <option value="">Select a verified backup…</option>
          {verified.map((r) => <option key={r.id} value={r.id}>{r.backupCode} — {formatDateTime(r.startedAt)}</option>)}
        </Select>
        <input value={targetLabel} onChange={(e) => setTargetLabel(e.target.value)} placeholder="Target, e.g. scratch DB lpp-restore-test" className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm" aria-label="Restore target" />
      </SensitiveActionDialog>

      <SensitiveActionDialog
        open={act != null}
        title={act ? `${act.action[0].toUpperCase()}${act.action.slice(1)} restore request` : "Restore request"}
        description="Requires your password. Approval must come from a different administrator than the requester."
        requireReason={false}
        onCancel={() => setAct(null)}
        onConfirm={async ({ stepUpToken }) => {
          if (!act) return null;
          const res = await callApi("/api/admin/system/restore-requests", "PATCH", { requestId: act.id, action: act.action, stepUpToken });
          if (!res.ok) return res.data.error ?? "Action failed";
          show("Updated", "success");
          reload();
          return null;
        }}
      />

      <SensitiveActionDialog
        open={validateOpen}
        title="Post-restore validation"
        description="Read-only: checks connectivity, the core data sets, and runs every integrity check."
        requireReason={false}
        onCancel={() => setValidateOpen(false)}
        onConfirm={async ({ stepUpToken }) => {
          const res = await callApi<{ passed: boolean; results: Check[] }>("/api/admin/system/restore-requests", "PATCH", { action: "validate", stepUpToken });
          if (!res.ok) return res.data.error ?? "Validation failed to run";
          setValidation(res.data);
          show(res.data.passed ? "Validation passed" : "Validation found problems", res.data.passed ? "success" : "error");
          return null;
        }}
      />
    </div>
  );
}
