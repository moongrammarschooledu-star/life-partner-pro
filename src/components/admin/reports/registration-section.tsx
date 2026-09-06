"use client";

import { useReportSection } from "@/components/admin/reports/use-report-section";
import { SectionShell } from "@/components/admin/reports/section-shell";
import { BarChart } from "@/components/admin/bar-chart";
import { TrendChart } from "@/components/admin/trend-chart";

interface RegistrationData {
  totalInRange: number;
  dailyTrend: { label: string; count: number }[];
  newVsVerifiedVsActiveVsRejected: { label: string; series: Record<string, number> }[];
}

export function RegistrationSection({ queryString, enabled }: { queryString: string; enabled: boolean }) {
  const { data, loading, error } = useReportSection<RegistrationData>("/api/admin/reports/registration", queryString, enabled);

  return (
    <SectionShell loading={loading} error={error} isEmpty={!data || data.totalInRange === 0}>
      {data && (
        <div className="space-y-6">
          <div className="rounded-xl border border-border bg-surface p-4">
            <BarChart title={`Daily Registrations (${data.totalInRange} total in range)`} data={data.dailyTrend} />
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <TrendChart
              data={data.newVsVerifiedVsActiveVsRejected}
              seriesConfig={[
                { key: "new", label: "New", colorClass: "bg-primary" },
                { key: "verified", label: "Verified", colorClass: "bg-success" },
                { key: "active", label: "Active", colorClass: "bg-accent" },
                { key: "rejected", label: "Rejected", colorClass: "bg-danger" },
              ]}
            />
          </div>
        </div>
      )}
    </SectionShell>
  );
}
