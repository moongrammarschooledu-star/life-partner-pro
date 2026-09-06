"use client";

import { useReportSection } from "@/components/admin/reports/use-report-section";
import { SectionShell } from "@/components/admin/reports/section-shell";
import { BarChart } from "@/components/admin/bar-chart";

interface VerificationData {
  counts: Record<string, number>;
  approvalRate: number | null;
  reVerificationRate: number | null;
  avgTurnaroundHours: number | null;
  pendingCount: number;
}

const RATE_LABEL = (v: number | null) => (v == null ? "Not enough data" : `${v}%`);

export function VerificationSection({ queryString, enabled }: { queryString: string; enabled: boolean }) {
  const { data, loading, error } = useReportSection<VerificationData>("/api/admin/reports/verification", queryString, enabled);

  return (
    <SectionShell loading={loading} error={error} isEmpty={!data}>
      {data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Approval Rate" value={RATE_LABEL(data.approvalRate)} />
            <Metric label="Re-Verification Rate" value={RATE_LABEL(data.reVerificationRate)} />
            <Metric label="Avg. Turnaround" value={data.avgTurnaroundHours != null ? `${data.avgTurnaroundHours}h` : "Not enough data"} />
            <Metric label="Pending Review" value={String(data.pendingCount)} />
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <BarChart
              title="Verification Status"
              data={Object.entries(data.counts).map(([label, count]) => ({ label, count }))}
            />
          </div>
        </div>
      )}
    </SectionShell>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}
