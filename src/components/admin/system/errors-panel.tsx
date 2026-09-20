"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";
import { Loading, ErrorNote, StatusBadge, useApi, callApi } from "@/components/admin/system/shared";

const CATEGORIES = ["AUTH_ERROR", "AUTHORIZATION_ERROR", "VALIDATION_ERROR", "DATABASE_ERROR", "STORAGE_ERROR", "PAYMENT_ERROR", "WEBHOOK_ERROR", "NOTIFICATION_ERROR", "MATCHING_ERROR", "PROPOSAL_ERROR", "VERIFICATION_ERROR", "SUPPORT_ERROR", "SECURITY_ERROR", "SYSTEM_ERROR"];

interface ErrorItem { id: string; category: string; severity: string; service: string; route: string | null; message: string; environment: string; appVersion: string | null; correlationId: string | null; status: string; occurrences: number; firstSeenAt: string; lastSeenAt: string }

export function ErrorsPanel() {
  const { show } = useToast();
  const [f, setF] = useState({ severity: "", category: "", status: "", environment: "", service: "", from: "", to: "", page: 1 });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== "" && v !== 1).map(([k, v]) => [k, String(v)]));
  if (f.page > 1) qs.set("page", String(f.page));
  const { data, error, loading, reload } = useApi<{ items: ErrorItem[]; total: number; pageSize: number }>(`/api/admin/system/errors?${qs.toString()}`);

  async function setStatus(id: string, status: string) {
    const res = await callApi(`/api/admin/system/errors/${id}`, "PATCH", { status });
    if (res.ok) { show("Updated", "success"); reload(); } else show(res.data.error ?? "Could not update", "error");
  }
  const set = (patch: Partial<typeof f>) => setF((prev) => ({ ...prev, ...patch, page: patch.page ?? 1 }));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <Select value={f.severity} onChange={(e) => set({ severity: e.target.value })} aria-label="Severity"><option value="">Any severity</option>{["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((s) => <option key={s}>{s}</option>)}</Select>
        <Select value={f.category} onChange={(e) => set({ category: e.target.value })} aria-label="Category"><option value="">Any category</option>{CATEGORIES.map((s) => <option key={s}>{s}</option>)}</Select>
        <Select value={f.status} onChange={(e) => set({ status: e.target.value })} aria-label="Status"><option value="">Any status</option>{["NEW", "ACKNOWLEDGED", "RESOLVED"].map((s) => <option key={s}>{s}</option>)}</Select>
        <Select value={f.environment} onChange={(e) => set({ environment: e.target.value })} aria-label="Environment"><option value="">Any environment</option>{["production", "staging", "development"].map((s) => <option key={s}>{s}</option>)}</Select>
        <Select value={f.service} onChange={(e) => set({ service: e.target.value })} aria-label="Service"><option value="">Any service</option>{["API", "RENDER", "FRONTEND", "CRON", "JOB", "WEBHOOK", "SELFTEST"].map((s) => <option key={s}>{s}</option>)}</Select>
        <input type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} className="h-10 rounded-lg border border-border bg-surface px-3 text-sm" aria-label="From date" />
        <input type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} className="h-10 rounded-lg border border-border bg-surface px-3 text-sm" aria-label="To date" />
      </div>

      {loading && !data ? <Loading /> : error ? <ErrorNote message={error} /> : !data || data.items.length === 0 ? (
        <EmptyState icon={AlertTriangle} title="No errors match these filters" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="p-3">Last seen</th><th className="p-3">Severity</th><th className="p-3">Category</th><th className="p-3">Where</th><th className="p-3">Message (redacted)</th><th className="p-3">Count</th><th className="p-3">Status</th><th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {data.items.map((e) => (
                  <tr key={e.id} className="border-b border-border align-top last:border-0">
                    <td className="p-3 text-muted whitespace-nowrap">{formatDateTime(e.lastSeenAt)}</td>
                    <td className="p-3"><StatusBadge status={e.severity} /></td>
                    <td className="p-3 font-mono text-xs">{e.category}</td>
                    <td className="p-3 text-xs">{e.service}<br /><span className="text-muted">{e.route ?? "—"}</span><br /><span className="text-muted">{e.environment}{e.appVersion ? ` · v${e.appVersion}` : ""}</span></td>
                    <td className="p-3 max-w-md break-words">{e.message}{e.correlationId && <div className="mt-1 font-mono text-xs text-muted">cid {e.correlationId.slice(0, 8)}</div>}</td>
                    <td className="p-3">{e.occurrences}</td>
                    <td className="p-3"><StatusBadge status={e.status} /></td>
                    <td className="p-3 whitespace-nowrap">
                      {e.status === "NEW" && <Button size="sm" variant="outline" onClick={() => setStatus(e.id, "ACKNOWLEDGED")}>Acknowledge</Button>}{" "}
                      {e.status !== "RESOLVED" && <Button size="sm" variant="outline" onClick={() => setStatus(e.id, "RESOLVED")}>Resolve</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-sm text-muted">
            <span>{data.total} record(s)</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={f.page <= 1} onClick={() => set({ page: f.page - 1 })}>Previous</Button>
              <Button size="sm" variant="outline" disabled={f.page * data.pageSize >= data.total} onClick={() => set({ page: f.page + 1 })}>Next</Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
