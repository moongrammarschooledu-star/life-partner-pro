"use client";

import { useReportSection } from "@/components/admin/reports/use-report-section";
import { SectionShell } from "@/components/admin/reports/section-shell";
import { BarChart } from "@/components/admin/bar-chart";
import { StatCard } from "@/components/admin/stat-card";
import { formatEnumLabel } from "@/lib/utils";
import { Briefcase, FolderOpen, FolderCheck, ArrowUpCircle, RotateCcw, AlertTriangle, Gauge, TrendingUp } from "lucide-react";

interface CasesReportData {
  byCategory: { label: string; count: number }[];
  byStatus: { label: string; count: number }[];
  byPriority: { label: string; count: number }[];
  byType: { label: string; count: number }[];
  totalCases: number;
  openCases: number;
  closedCases: number;
  escalatedCases: number;
  reopenedCases: number;
  escalationRate: number | null;
  slaCompliance: number | null;
  slaOverdueCount: number;
  avgFirstResponseHours: number | null;
  avgResolutionHours: number | null;
}

// Spec §38 — real numbers from the Case table, never fabricated; a null
// rate (below the safe-sample threshold) renders as "Not enough data"
// rather than a misleading 0%.
export function CasesSection({ queryString, enabled }: { queryString: string; enabled: boolean }) {
  const { data, loading, error } = useReportSection<CasesReportData>("/api/admin/reports/cases", queryString, enabled);

  return (
    <SectionShell loading={loading} error={error} isEmpty={!data}>
      {data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <StatCard icon={Briefcase} label="Total Cases" value={data.totalCases} />
            <StatCard icon={FolderOpen} label="Open Cases" value={data.openCases} accent="info" />
            <StatCard icon={FolderCheck} label="Closed Cases" value={data.closedCases} accent="success" />
            <StatCard icon={ArrowUpCircle} label="Escalated" value={data.escalatedCases} accent="warning" />
            <StatCard icon={RotateCcw} label="Reopened" value={data.reopenedCases} />
            <StatCard icon={AlertTriangle} label="Overdue (SLA)" value={data.slaOverdueCount} accent={data.slaOverdueCount > 0 ? "danger" : "success"} />
            <StatCard icon={Gauge} label="SLA Compliance" value={data.slaCompliance != null ? `${data.slaCompliance}%` : "Not enough data"} accent="info" />
            <StatCard icon={TrendingUp} label="Escalation Rate" value={data.escalationRate != null ? `${data.escalationRate}%` : "Not enough data"} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="mb-1 text-sm font-medium">Avg. First Response</p>
              <p className="text-2xl font-semibold">{data.avgFirstResponseHours != null ? `${data.avgFirstResponseHours}h` : "Not enough data"}</p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="mb-1 text-sm font-medium">Avg. Resolution Time</p>
              <p className="text-2xl font-semibold">{data.avgResolutionHours != null ? `${data.avgResolutionHours}h` : "Not enough data"}</p>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface p-4">
            <BarChart title="Cases by Type" data={data.byType.map((t) => ({ label: formatEnumLabel(t.label), count: t.count }))} />
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <BarChart title="Cases by Status" data={data.byStatus.map((s) => ({ label: formatEnumLabel(s.label), count: s.count }))} />
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <BarChart title="Cases by Priority" data={data.byPriority.map((p) => ({ label: formatEnumLabel(p.label), count: p.count }))} />
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <BarChart title="Cases by Category" data={data.byCategory.map((c) => ({ label: formatEnumLabel(c.label), count: c.count }))} />
          </div>
        </div>
      )}
    </SectionShell>
  );
}
