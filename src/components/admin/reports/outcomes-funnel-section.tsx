"use client";

import { useReportSection } from "@/components/admin/reports/use-report-section";
import { SectionShell } from "@/components/admin/reports/section-shell";
import { BarChart } from "@/components/admin/bar-chart";
import { TrendChart } from "@/components/admin/trend-chart";
import { FunnelChart } from "@/components/admin/funnel-chart";

interface OutcomeData {
  counts: Record<string, number>;
  trend: { label: string; series: Record<string, number> }[];
}

interface FunnelData {
  stages: { key: string; label: string; count: number; href?: string }[];
}

// Spec §16/§17 — outcome counts + trend, and the 10-stage success funnel,
// each stage clickable to a pre-filtered list.
export function OutcomesFunnelSection({ queryString, enabled }: { queryString: string; enabled: boolean }) {
  const outcomes = useReportSection<OutcomeData>("/api/admin/reports/outcomes", queryString, enabled);
  const funnel = useReportSection<FunnelData>("/api/admin/reports/funnel", queryString, enabled);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-surface p-4">
        <p className="mb-4 text-sm font-medium">Success Funnel</p>
        <SectionShell loading={funnel.loading} error={funnel.error} isEmpty={!funnel.data}>
          {funnel.data && <FunnelChart stages={funnel.data.stages} />}
        </SectionShell>
      </div>
      <SectionShell loading={outcomes.loading} error={outcomes.error} isEmpty={!outcomes.data}>
        {outcomes.data && (
          <div className="space-y-6">
            <div className="rounded-xl border border-border bg-surface p-4">
              <BarChart title="Rishta Outcomes" data={Object.entries(outcomes.data.counts).map(([label, count]) => ({ label, count }))} />
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <TrendChart
                data={outcomes.data.trend}
                seriesConfig={[
                  { key: "accepted", label: "Accepted", colorClass: "bg-primary" },
                  { key: "finalized", label: "Finalized", colorClass: "bg-accent" },
                  { key: "married", label: "Married", colorClass: "bg-success" },
                  { key: "rejected", label: "Rejected", colorClass: "bg-danger" },
                ]}
              />
            </div>
          </div>
        )}
      </SectionShell>
    </div>
  );
}
