"use client";

import { useReportSection } from "@/components/admin/reports/use-report-section";
import { SectionShell } from "@/components/admin/reports/section-shell";
import { KpiCard } from "@/components/admin/kpi-card";
import { BarChart } from "@/components/admin/bar-chart";
import type { KpiResult } from "@/lib/reports/types";

interface OverviewData {
  kpis: Record<string, KpiResult>;
  registrationTrend: { label: string; count: number }[];
}

const CARDS: { key: keyof OverviewData["kpis"]; label: string; href?: string }[] = [
  { key: "totalProfiles", label: "Total Profiles", href: "/admin/profiles" },
  { key: "newProfiles", label: "New Profiles", href: "/admin/profiles?status=NEW" },
  { key: "verifiedProfiles", label: "Verified Profiles", href: "/admin/profiles?verified=true" },
  { key: "activeProfiles", label: "Active Profiles", href: "/admin/profiles?status=ACTIVE" },
  { key: "underReviewProfiles", label: "Under Review", href: "/admin/profiles?status=UNDER_REVIEW" },
  { key: "totalMatches", label: "Total Matches", href: "/admin/matches" },
  { key: "highCompatMatches", label: "High Compatibility", href: "/admin/matches" },
  { key: "totalProposals", label: "Total Proposals", href: "/admin/proposals" },
  { key: "mutualInterest", label: "Mutual Interest", href: "/admin/proposals?statusGroup=mutual_interest" },
  { key: "meetingsScheduled", label: "Meetings Scheduled", href: "/admin/meetings" },
  { key: "accepted", label: "Accepted", href: "/admin/proposals?statusGroup=outcome" },
  { key: "finalized", label: "Finalized Rishtas", href: "/admin/proposals?statusGroup=outcome" },
  { key: "married", label: "Married Outcomes", href: "/admin/proposals?statusGroup=outcome" },
  { key: "rejected", label: "Rejected Proposals", href: "/admin/proposals?statusGroup=outcome" },
];

export function OverviewSection({ queryString, enabled }: { queryString: string; enabled: boolean }) {
  const { data, loading, error } = useReportSection<OverviewData>("/api/admin/reports", queryString, enabled);

  return (
    <SectionShell loading={loading} error={error} isEmpty={!data}>
      {data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {CARDS.map((c) => (
              <KpiCard key={c.key} label={c.label} kpi={data.kpis[c.key]} href={c.href} />
            ))}
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <BarChart title="Registration Volume (selected period)" data={data.registrationTrend} />
          </div>
        </div>
      )}
    </SectionShell>
  );
}
