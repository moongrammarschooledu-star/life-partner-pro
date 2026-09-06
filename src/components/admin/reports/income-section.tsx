"use client";

import { useReportSection } from "@/components/admin/reports/use-report-section";
import { SectionShell } from "@/components/admin/reports/section-shell";
import { BarChart } from "@/components/admin/bar-chart";

interface IncomeData {
  totalProfiles: number;
  disclosedCount: number;
  buckets: { label: string; count: number }[];
}

// Spec §9 — aggregated only, never individual income values. Route already
// enforces reports:income:view server-side; this component is only mounted
// when the client-side permission check also passes.
export function IncomeSection({ queryString, enabled }: { queryString: string; enabled: boolean }) {
  const { data, loading, error } = useReportSection<IncomeData>("/api/admin/reports/income", queryString, enabled);

  return (
    <SectionShell loading={loading} error={error} isEmpty={!data || data.disclosedCount === 0}>
      {data && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="mb-4 text-xs text-muted">
            {data.disclosedCount} of {data.totalProfiles} profiles disclosed income — aggregated counts only, never individual values.
          </p>
          <BarChart title="Income Distribution" data={data.buckets} />
        </div>
      )}
    </SectionShell>
  );
}
