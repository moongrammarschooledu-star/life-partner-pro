"use client";

import { useReportSection } from "@/components/admin/reports/use-report-section";
import { SectionShell } from "@/components/admin/reports/section-shell";
import { BarChart } from "@/components/admin/bar-chart";

interface MatchingData {
  total: number;
  reviewed: number;
  tiers: { label: string; count: number }[];
  avgScore: number | null;
  avgMutualCompatibility: number | null;
  matchesPerProfile: number | null;
  adminReviewedCount: number;
  convertedToProposals: number;
  conversionRate: number | null;
}

// Spec §12/§13 — compatibility tiers via STEP 6's normalized scoring. Never
// described as a guarantee of marriage.
export function MatchingSection({ queryString, enabled }: { queryString: string; enabled: boolean }) {
  const { data, loading, error } = useReportSection<MatchingData>("/api/admin/reports/matching", queryString, enabled);

  return (
    <SectionShell loading={loading} error={error} isEmpty={!data || data.total === 0}>
      {data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Total Matches" value={String(data.total)} />
            <Metric label="Admin Reviewed" value={String(data.adminReviewedCount)} />
            <Metric label="Avg. Compatibility" value={data.avgScore != null ? `${data.avgScore}%` : "—"} />
            <Metric label="Avg. Mutual Compatibility" value={data.avgMutualCompatibility != null ? `${data.avgMutualCompatibility}%` : "—"} />
            <Metric label="Matches / Profile" value={data.matchesPerProfile != null ? String(data.matchesPerProfile) : "—"} />
            <Metric label="Converted to Proposals" value={String(data.convertedToProposals)} />
            <Metric label="Conversion Rate" value={data.conversionRate != null ? `${data.conversionRate}%` : "Not enough data"} />
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <BarChart title="Compatibility Tiers" data={data.tiers} />
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
