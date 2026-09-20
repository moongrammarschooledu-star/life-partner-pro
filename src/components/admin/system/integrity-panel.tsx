"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/utils";
import { Card, Loading, ErrorNote, StatusBadge, useApi, callApi } from "@/components/admin/system/shared";

interface Finding { key: string; description: string; severity: string; count: number }
interface Run { id: string; trigger: string; startedAt: string; status: string; totalChecks: number; findingCount: number; findings: Finding[] | null }

export function IntegrityPanel({ canRun }: { canRun: boolean }) {
  const { show } = useToast();
  const { data, error, loading, reload } = useApi<{ runs: Run[]; checkCount: number }>("/api/admin/system/integrity");
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const res = await callApi<{ status: string }>("/api/admin/system/integrity", "POST", {});
      show(res.ok ? `Integrity checks: ${res.data.status}` : res.data.error ?? "Could not run", res.ok ? "success" : "error");
      reload();
    } finally { setBusy(false); }
  }

  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;
  const latest = data.runs[0];

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">{data.checkCount} read-only checks (duplicate payments, paid-without-invoice, impossible status combinations, subscription/entitlement consistency, orphan links, missing audit records). Findings are reported — never auto-corrected; high-risk data needs controlled, audited remediation.</p>
      {canRun && <Button size="sm" disabled={busy} onClick={run}>{busy ? "Running…" : "Run integrity checks now"}</Button>}

      {!latest ? <EmptyState icon={ShieldCheck} title="No integrity check has run yet" /> : (
        <Card title={`Latest run — ${formatDateTime(latest.startedAt)} (${latest.trigger.toLowerCase()})`} action={<StatusBadge status={latest.status} />}>
          {(latest.findings ?? []).length === 0 ? <p className="text-sm text-muted">No findings across {latest.totalChecks} checks.</p> : (
            <ul className="space-y-2 text-sm">
              {(latest.findings ?? []).map((f) => (
                <li key={f.key} className="flex items-start gap-2"><StatusBadge status={f.severity} /><span><b>{f.count}</b> — {f.description} <span className="font-mono text-xs text-muted">{f.key}</span></span></li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {data.runs.length > 1 && (
        <Card title="History">
          <ul className="space-y-1 text-sm">
            {data.runs.map((r) => <li key={r.id} className="flex items-center gap-3"><span className="text-muted">{formatDateTime(r.startedAt)}</span><StatusBadge status={r.status} /><span>{r.findingCount} finding(s)</span><span className="text-xs text-muted">{r.trigger.toLowerCase()}</span></li>)}
          </ul>
        </Card>
      )}
    </div>
  );
}
