"use client";

import { useReportSection } from "@/components/admin/reports/use-report-section";
import { SectionShell } from "@/components/admin/reports/section-shell";
import { BarChart } from "@/components/admin/bar-chart";

interface MeetingData {
  total: number;
  counts: { requested: number; scheduled: number; confirmed: number; completed: number; cancelled: number; rescheduled: number; staleRequests: number };
  completionRate: number | null;
  meetingToAcceptanceRate: number | null;
}

const RATE = (v: number | null) => (v == null ? "Not enough data" : `${v}%`);

export function MeetingsSection({ queryString, enabled }: { queryString: string; enabled: boolean }) {
  const { data, loading, error } = useReportSection<MeetingData>("/api/admin/reports/meetings", queryString, enabled);

  return (
    <SectionShell loading={loading} error={error} isEmpty={!data || data.total === 0}>
      {data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Completion Rate" value={RATE(data.completionRate)} />
            <Metric label="Meeting → Acceptance Rate" value={RATE(data.meetingToAcceptanceRate)} />
            <Metric label="Stale Requests (7d+)" value={String(data.counts.staleRequests)} />
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <BarChart
              title="Meetings by Status"
              data={[
                { label: "Requested", count: data.counts.requested },
                { label: "Scheduled", count: data.counts.scheduled },
                { label: "Confirmed", count: data.counts.confirmed },
                { label: "Completed", count: data.counts.completed },
                { label: "Cancelled", count: data.counts.cancelled },
                { label: "Rescheduled", count: data.counts.rescheduled },
              ]}
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
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}
