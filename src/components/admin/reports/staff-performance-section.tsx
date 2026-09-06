"use client";

import { useReportSection } from "@/components/admin/reports/use-report-section";
import { SectionShell } from "@/components/admin/reports/section-shell";
import { formatEnumLabel } from "@/lib/utils";

interface StaffRow {
  adminId: string;
  name: string;
  role: string;
  profilesReviewed: number;
  verificationsCompleted: number;
  proposalsCreated: number;
  followUpsCompleted: number;
  meetingsManaged: number;
  finalizedProposals: number;
  avgResponseTimeHours: number | null;
}

// Spec §18 — Super-Admin-only, operational/workload visibility, presented
// alphabetically (never a competitive ranking).
export function StaffPerformanceSection({ queryString, enabled }: { queryString: string; enabled: boolean }) {
  const { data, loading, error } = useReportSection<{ items: StaffRow[] }>("/api/admin/reports/staff-performance", queryString, enabled);

  return (
    <SectionShell loading={loading} error={error} isEmpty={!data || data.items.length === 0}>
      {data && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="mb-1 text-sm font-medium">Staff Workload — Operational View</p>
          <p className="mb-4 text-xs text-muted">For workload/operational management only — not a performance ranking.</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="pb-2">Admin</th>
                  <th className="pb-2">Role</th>
                  <th className="pb-2 text-right">Profiles Reviewed</th>
                  <th className="pb-2 text-right">Verifications</th>
                  <th className="pb-2 text-right">Proposals Created</th>
                  <th className="pb-2 text-right">Follow-Ups Completed</th>
                  <th className="pb-2 text-right">Meetings Managed</th>
                  <th className="pb-2 text-right">Finalized</th>
                  <th className="pb-2 text-right">Avg. Follow-Up Response</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <tr key={row.adminId} className="border-t border-border">
                    <td className="py-2 font-medium">{row.name}</td>
                    <td className="py-2 text-muted">{formatEnumLabel(row.role)}</td>
                    <td className="py-2 text-right">{row.profilesReviewed}</td>
                    <td className="py-2 text-right">{row.verificationsCompleted}</td>
                    <td className="py-2 text-right">{row.proposalsCreated}</td>
                    <td className="py-2 text-right">{row.followUpsCompleted}</td>
                    <td className="py-2 text-right">{row.meetingsManaged}</td>
                    <td className="py-2 text-right">{row.finalizedProposals}</td>
                    <td className="py-2 text-right">{row.avgResponseTimeHours != null ? `${row.avgResponseTimeHours}h` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </SectionShell>
  );
}
