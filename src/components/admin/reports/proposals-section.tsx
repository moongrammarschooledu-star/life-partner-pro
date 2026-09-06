"use client";

import { useReportSection } from "@/components/admin/reports/use-report-section";
import { SectionShell } from "@/components/admin/reports/section-shell";
import { BarChart } from "@/components/admin/bar-chart";

interface ProposalData {
  total: number;
  byStatus: Record<string, number>;
  trend: { label: string; count: number }[];
  rates: { interestRate: number | null; mutualInterestRate: number | null; meetingRate: number | null; acceptanceRate: number | null; finalizationRate: number | null };
}

const RATE = (v: number | null) => (v == null ? "Not enough data" : `${v}%`);

export function ProposalsSection({ queryString, enabled }: { queryString: string; enabled: boolean }) {
  const { data, loading, error } = useReportSection<ProposalData>("/api/admin/reports/proposals", queryString, enabled);

  return (
    <SectionShell loading={loading} error={error} isEmpty={!data || data.total === 0}>
      {data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Metric label="Interest Rate" value={RATE(data.rates.interestRate)} />
            <Metric label="Mutual Interest Rate" value={RATE(data.rates.mutualInterestRate)} />
            <Metric label="Meeting Rate" value={RATE(data.rates.meetingRate)} />
            <Metric label="Acceptance Rate" value={RATE(data.rates.acceptanceRate)} />
            <Metric label="Finalization Rate" value={RATE(data.rates.finalizationRate)} />
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <BarChart title="Proposals by Status" data={Object.entries(data.byStatus).map(([label, count]) => ({ label, count }))} />
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <BarChart title="Proposal Volume Over Time" data={data.trend} />
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
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}
