"use client";

import { Gauge } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime } from "@/lib/utils";
import { Card, Loading, ErrorNote, useApi } from "@/components/admin/system/shared";

interface Perf {
  windowHours: number;
  thresholds: { apiLatencyWarnMs: number; slowQueryThresholdMs: number };
  instrumentedRoutes: Array<{ route: string; requests: number; errors: number; slow: number; avgMs: number; maxMs: number; errorRate: number }>;
  counters: Record<string, number>;
  slowQueries: Array<{ id: string; operation: string; table: string; route: string | null; count: number; avgMs: number; maxMs: number; lastMs: number; lastSeenAt: string }>;
  note: string;
}

export function PerformancePanel() {
  const { data, error, loading } = useApi<Perf>("/api/admin/system/performance");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">{data.note} Warning thresholds: API {data.thresholds.apiLatencyWarnMs} ms · slow query {data.thresholds.slowQueryThresholdMs} ms (System Configuration → Monitoring).</p>

      <Card title={`Slow queries (top ${data.slowQueries.length})`}>
        {data.slowQueries.length === 0 ? (
          <EmptyState icon={Gauge} title="No slow queries recorded" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted"><th className="p-2">Endpoint</th><th className="p-2">Operation</th><th className="p-2">Table</th><th className="p-2">Count</th><th className="p-2">Avg</th><th className="p-2">Max</th><th className="p-2">Last seen</th></tr></thead>
              <tbody>
                {data.slowQueries.map((s) => (
                  <tr key={s.id} className="border-b border-border last:border-0">
                    <td className="p-2 text-xs">{s.route ?? "— (not attributed)"}</td><td className="p-2 font-mono text-xs">{s.operation}</td><td className="p-2 font-mono text-xs">{s.table}</td>
                    <td className="p-2">{s.count}</td><td className="p-2">{s.avgMs} ms</td><td className="p-2">{s.maxMs} ms</td><td className="p-2 text-muted">{formatDateTime(s.lastSeenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-muted">Only the operation, table and duration are stored — never SQL text or parameters.</p>
      </Card>

      <Card title={`Instrumented routes (last ${data.windowHours} h)`}>
        {data.instrumentedRoutes.length === 0 ? (
          <p className="text-sm text-muted">No traffic recorded on instrumented routes yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted"><th className="p-2">Route</th><th className="p-2">Requests</th><th className="p-2">Avg</th><th className="p-2">Max</th><th className="p-2">Slow</th><th className="p-2">Errors</th></tr></thead>
              <tbody>
                {data.instrumentedRoutes.map((r) => (
                  <tr key={r.route} className="border-b border-border last:border-0">
                    <td className="p-2 font-mono text-xs">{r.route}</td><td className="p-2">{r.requests}</td>
                    <td className={`p-2 ${r.avgMs > data.thresholds.apiLatencyWarnMs ? "text-warning" : ""}`}>{r.avgMs} ms</td><td className="p-2">{r.maxMs} ms</td><td className="p-2">{r.slow}</td><td className="p-2">{r.errors} ({(r.errorRate * 100).toFixed(1)}%)</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-muted">Instrumented today: matching search, registration, checkout and admin search. Coverage is deliberately partial and stated here rather than implied.</p>
      </Card>

      <Card title="Hourly counters (24 h)">
        {Object.keys(data.counters).length === 0 ? <p className="text-sm text-muted">None recorded.</p> : (
          <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            {Object.entries(data.counters).map(([k, v]) => <div key={k} className="flex justify-between py-1 text-sm"><dt className="font-mono text-xs text-muted">{k}</dt><dd>{v}</dd></div>)}
          </dl>
        )}
      </Card>
    </div>
  );
}
