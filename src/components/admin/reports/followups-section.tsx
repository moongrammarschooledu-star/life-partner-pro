"use client";

import { useReportSection } from "@/components/admin/reports/use-report-section";
import { SectionShell } from "@/components/admin/reports/section-shell";

interface FollowUpData {
  today: number;
  completed: number;
  pending: number;
  overdue: number;
  completionRate: number | null;
  avgDelayHours: number | null;
}

const RATE = (v: number | null) => (v == null ? "Not enough data" : `${v}%`);

export function FollowupsSection({ queryString, enabled }: { queryString: string; enabled: boolean }) {
  const { data, loading, error } = useReportSection<FollowUpData>("/api/admin/reports/followups", queryString, enabled);

  return (
    <SectionShell loading={loading} error={error} isEmpty={!data}>
      {data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Metric label="Today" value={String(data.today)} />
          <Metric label="Completed" value={String(data.completed)} />
          <Metric label="Pending" value={String(data.pending)} />
          <Metric label="Overdue" value={String(data.overdue)} />
          <Metric label="Completion Rate" value={RATE(data.completionRate)} />
          <Metric label="Avg. Delay" value={data.avgDelayHours != null ? `${data.avgDelayHours}h` : "—"} />
        </div>
      )}
    </SectionShell>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}
