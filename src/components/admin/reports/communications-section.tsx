"use client";

import { useReportSection } from "@/components/admin/reports/use-report-section";
import { SectionShell } from "@/components/admin/reports/section-shell";
import { BarChart } from "@/components/admin/bar-chart";

interface CommunicationData {
  total: number;
  byChannel: Record<string, number>;
  byStatus: Record<string, number>;
  deliveryRate: number | null;
  failureRate: number | null;
  volumeByDay: { label: string; count: number }[];
}

const RATE = (v: number | null) => (v == null ? "Not enough data" : `${v}%`);

// Spec §20 — surfaces STEP 9's CommunicationLog data. Never exposes message
// content.
export function CommunicationsSection({ queryString, enabled }: { queryString: string; enabled: boolean }) {
  const { data, loading, error } = useReportSection<CommunicationData>("/api/admin/reports/communications", queryString, enabled);

  return (
    <SectionShell loading={loading} error={error} isEmpty={!data || data.total === 0}>
      {data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Total Sent" value={String(data.total)} />
            <Metric label="Delivery Rate" value={RATE(data.deliveryRate)} />
            <Metric label="Failure Rate" value={RATE(data.failureRate)} />
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-surface p-4">
              <BarChart title="By Channel" data={Object.entries(data.byChannel).map(([label, count]) => ({ label, count }))} />
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <BarChart title="By Delivery Status" data={Object.entries(data.byStatus).map(([label, count]) => ({ label, count }))} />
            </div>
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <BarChart title="Volume by Day" data={data.volumeByDay} />
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
