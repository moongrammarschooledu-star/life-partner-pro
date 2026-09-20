"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/utils";
import { ListChecks } from "lucide-react";
import { Card, Loading, ErrorNote, StatusBadge, useApi, callApi, timeAgo } from "@/components/admin/system/shared";

interface Job { id: string; type: string; status: string; attempts: number; maxAttempts: number; runAfter: string; createdAt: string; startedAt: string | null; completedAt: string | null; failureReason: string | null; resolved: boolean; correlationId: string | null }
interface Task { name: string; label: string; schedule: string; lastStartedAt: string | null; lastCompletedAt: string | null; lastStatus: string | null; lastDurationMs: number | null; consecutiveFailures: number; totalFailures: number; locked: boolean }

const STATUSES = ["PENDING", "RUNNING", "COMPLETED", "FAILED", "RETRYING", "DEAD_LETTER", "CANCELLED"];

export function JobsPanel({ canManage }: { canManage: boolean }) {
  const { show } = useToast();
  const [status, setStatus] = useState("");
  const [enqueueType, setEnqueueType] = useState("");
  const [busy, setBusy] = useState(false);
  const jobs = useApi<{ counts: Record<string, number>; items: Job[]; jobTypes: string[] }>(`/api/admin/system/jobs${status ? `?status=${status}` : ""}`);
  const cron = useApi<{ nextScheduledRun: string; note: string; tasks: Task[]; recentRuns: Array<{ id: string; taskName: string; startedAt: string; durationMs: number | null; status: string; error: string | null }> }>("/api/admin/system/cron");

  async function act(body: Record<string, unknown>, done = "Done") {
    setBusy(true);
    try {
      const res = await callApi("/api/admin/system/jobs", "POST", body);
      if (res.ok) { show(done, "success"); jobs.reload(); cron.reload(); } else show(res.data.error ?? "Action failed", "error");
    } finally { setBusy(false); }
  }

  async function runTick() {
    setBusy(true);
    try {
      const res = await callApi<{ status: string; error?: string }>("/api/admin/system/cron", "POST", {});
      show(res.ok ? `Daily tick ${res.data.status}` : res.data.error ?? "Could not run", res.ok && res.data.status === "SUCCESS" ? "success" : "error");
      jobs.reload(); cron.reload();
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <Card title="Scheduled tasks" action={canManage && <Button size="sm" disabled={busy} onClick={runTick}>{busy ? "Running…" : "Run daily tick now"}</Button>}>
        {cron.loading && !cron.data ? <Loading /> : cron.error ? <ErrorNote message={cron.error} /> : cron.data && (
          <>
            <p className="mb-3 text-xs text-muted">{cron.data.note} Next scheduled run: {formatDateTime(cron.data.nextScheduledRun)}. A lock prevents any task from running twice at once.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted"><th className="p-2">Task</th><th className="p-2">Last run</th><th className="p-2">Status</th><th className="p-2">Duration</th><th className="p-2">Failures</th></tr></thead>
                <tbody>
                  {cron.data.tasks.map((t) => (
                    <tr key={t.name} className="border-b border-border last:border-0">
                      <td className="p-2">{t.label}<div className="font-mono text-xs text-muted">{t.name}</div></td>
                      <td className="p-2 text-muted">{timeAgo(t.lastCompletedAt)}</td>
                      <td className="p-2">{t.locked ? <StatusBadge status="RUNNING" /> : <StatusBadge status={t.lastStatus} />}</td>
                      <td className="p-2">{t.lastDurationMs != null ? `${t.lastDurationMs} ms` : "—"}</td>
                      <td className="p-2">{t.consecutiveFailures} in a row · {t.totalFailures} total</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      <Card title="Background jobs" action={canManage && (
        <div className="flex gap-2">
          <Select value={enqueueType} onChange={(e) => setEnqueueType(e.target.value)} aria-label="Job type" className="h-9 w-52"><option value="">Enqueue job…</option>{(jobs.data?.jobTypes ?? []).map((t) => <option key={t}>{t}</option>)}</Select>
          <Button size="sm" variant="outline" disabled={!enqueueType || busy} onClick={() => act({ action: "enqueue", type: enqueueType }, "Job enqueued")}>Add</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => act({ action: "run" }, "Worker ran")}>Run due jobs</Button>
        </div>
      )}>
        <div className="mb-3 flex flex-wrap gap-2">
          <button onClick={() => setStatus("")} className={`rounded-full px-3 py-1 text-xs ${status === "" ? "bg-primary text-white" : "bg-surface-muted text-muted"}`}>All</button>
          {STATUSES.map((s) => (
            <button key={s} onClick={() => setStatus(s)} className={`rounded-full px-3 py-1 text-xs ${status === s ? "bg-primary text-white" : "bg-surface-muted text-muted"}`}>{s.replace("_", " ")} ({jobs.data?.counts[s] ?? 0})</button>
          ))}
        </div>
        {jobs.loading && !jobs.data ? <Loading /> : jobs.error ? <ErrorNote message={jobs.error} /> : !jobs.data || jobs.data.items.length === 0 ? <EmptyState icon={ListChecks} title="No jobs" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted"><th className="p-2">Job</th><th className="p-2">Status</th><th className="p-2">Attempts</th><th className="p-2">Created / next</th><th className="p-2">Failure (safe)</th><th className="p-2" /></tr></thead>
              <tbody>
                {jobs.data.items.map((j) => (
                  <tr key={j.id} className="border-b border-border align-top last:border-0">
                    <td className="p-2 font-mono text-xs">{j.type}<div className="text-muted">{j.id.slice(-8)}{j.correlationId ? ` · cid ${j.correlationId.slice(0, 8)}` : ""}</div></td>
                    <td className="p-2"><StatusBadge status={j.status} />{j.resolved && <div className="text-xs text-muted">resolved</div>}</td>
                    <td className="p-2">{j.attempts}/{j.maxAttempts}</td>
                    <td className="p-2 text-xs text-muted">{formatDateTime(j.createdAt)}{(j.status === "PENDING" || j.status === "RETRYING") && <div>runs after {formatDateTime(j.runAfter)}</div>}</td>
                    <td className="p-2 max-w-xs break-words text-xs text-danger">{j.failureReason ?? ""}</td>
                    <td className="p-2 whitespace-nowrap">
                      {canManage && (j.status === "FAILED" || j.status === "DEAD_LETTER") && <Button size="sm" variant="outline" disabled={busy} onClick={() => act({ action: "retry", jobId: j.id }, "Job re-queued")}>Retry</Button>}{" "}
                      {canManage && ["PENDING", "RETRYING", "FAILED"].includes(j.status) && <Button size="sm" variant="outline" disabled={busy} onClick={() => act({ action: "cancel", jobId: j.id }, "Cancelled")}>Cancel</Button>}{" "}
                      {canManage && (j.status === "FAILED" || j.status === "DEAD_LETTER") && !j.resolved && <Button size="sm" variant="outline" disabled={busy} onClick={() => act({ action: "resolve", jobId: j.id }, "Marked resolved")}>Mark resolved</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-muted">Only safe metadata is shown — job payloads are never displayed. Every manual retry / cancel / resolve is audited.</p>
      </Card>
    </div>
  );
}
