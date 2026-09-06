"use client";

import { useEffect, useState } from "react";
import { Users2 } from "lucide-react";
import { formatEnumLabel } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

interface WorkloadRow {
  adminId: string;
  name: string;
  role: string;
  assignedProfiles: number;
  assignedProposals: number;
  pendingVerifications: number;
  pendingFollowUps: number;
  upcomingMeetings: number;
  overdueTasks: number;
  completedTasksLast30Days: number;
}

// Spec §9 — workload/service-quality view for ADMIN+SUPER_ADMIN. Presented
// alphabetically, never as a ranking — mirrors the same framing STEP 10's
// Staff Performance report already established.
export default function TeamWorkloadPage() {
  const [items, setItems] = useState<WorkloadRow[] | null>(null);

  useEffect(() => {
    fetch("/api/admin/reports/team-workload")
      .then((r) => r.json())
      .then((data) => setItems(data.items ?? []));
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Team Workload</h1>
        <p className="text-sm text-muted">Current assigned work per staff member — for workload management, not a performance ranking.</p>
      </div>

      {items === null ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={Users2} title="No staff accounts yet" description="Team workload appears here once staff or viewer accounts are created." />
      ) : (
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="pb-2">Staff Member</th>
                  <th className="pb-2">Role</th>
                  <th className="pb-2 text-right">Assigned Profiles</th>
                  <th className="pb-2 text-right">Assigned Proposals</th>
                  <th className="pb-2 text-right">Pending Verifications</th>
                  <th className="pb-2 text-right">Pending Follow-Ups</th>
                  <th className="pb-2 text-right">Upcoming Meetings</th>
                  <th className="pb-2 text-right">Overdue Tasks</th>
                  <th className="pb-2 text-right">Completed (30 days)</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.adminId} className="border-t border-border">
                    <td className="py-2 font-medium">{row.name}</td>
                    <td className="py-2 text-muted">{formatEnumLabel(row.role)}</td>
                    <td className="py-2 text-right">{row.assignedProfiles}</td>
                    <td className="py-2 text-right">{row.assignedProposals}</td>
                    <td className="py-2 text-right">{row.pendingVerifications}</td>
                    <td className="py-2 text-right">{row.pendingFollowUps}</td>
                    <td className="py-2 text-right">{row.upcomingMeetings}</td>
                    <td className={`py-2 text-right ${row.overdueTasks > 0 ? "font-medium text-danger" : ""}`}>{row.overdueTasks}</td>
                    <td className="py-2 text-right">{row.completedTasksLast30Days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
