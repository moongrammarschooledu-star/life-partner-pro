"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Workflow, Users, Kanban, BarChart3, UserPlus } from "lucide-react";
import { StatCard } from "@/components/admin/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/form";
import { buttonClass } from "@/components/ui/button";
import { formatEnumLabel } from "@/lib/utils";
import { timeAgo } from "@/components/admin/system/shared";

interface CrmRecordRow {
  id: string;
  crmCode: string;
  lifecycleStage: string;
  priority: string;
  assignmentStatus: string;
  lastActivityAt: string | null;
  profile: { id: string; fullName: string; profileCode: string };
  assignedStaff: { id: string; name: string } | null;
}

interface CrmListResponse {
  items: CrmRecordRow[];
  kpi: Array<{ lifecycleStage: string; count: number }>;
}

// STEP 28 §17/§18 — CRM dashboard + table view. Pipeline (Kanban), Leads,
// and Reports are their own pages (linked below) rather than in-page tabs —
// each has its own distinct layout.
export default function CrmDashboardPage() {
  const [data, setData] = useState<CrmListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState("");

  useEffect(() => {
    const qs = stageFilter ? `?lifecycleStage=${stageFilter}` : "";
    fetch(`/api/admin/crm${qs}`, { cache: "no-store" })
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error ?? "Failed to load");
        setData(json);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [stageFilter]);

  const totalRecords = data?.kpi.reduce((sum, k) => sum + k.count, 0) ?? 0;
  const activeCount = data?.kpi.filter((k) => !["MARRIED", "ARCHIVED", "REJECTED", "DEACTIVATED", "NOT_INTERESTED"].includes(k.lifecycleStage)).reduce((s, k) => s + k.count, 0) ?? 0;
  const unassignedCount = data?.items.filter((r) => !r.assignedStaff).length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">CRM &amp; Applicant Lifecycle</h1>
          <p className="text-sm text-muted">One operational view of every applicant — lifecycle stage, ownership, and next action.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/crm/pipeline" className={buttonClass({ variant: "secondary" })}><Kanban className="mr-1.5 h-4 w-4" />Pipeline</Link>
          <Link href="/admin/crm/leads" className={buttonClass({ variant: "secondary" })}><UserPlus className="mr-1.5 h-4 w-4" />Leads</Link>
          <Link href="/admin/crm/reports" className={buttonClass({ variant: "secondary" })}><BarChart3 className="mr-1.5 h-4 w-4" />Reports</Link>
        </div>
      </div>

      {error && <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">{error}</div>}

      {!data && !error ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
      ) : data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard icon={Workflow} label="Total CRM Records" value={totalRecords} />
          <StatCard icon={Users} label="Active in Pipeline" value={activeCount} accent="info" />
          <StatCard icon={UserPlus} label="Unassigned (page)" value={unassignedCount} accent={unassignedCount > 0 ? "warning" : "success"} />
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} className="max-w-xs">
          <option value="">All lifecycle stages</option>
          {(data?.kpi ?? []).map((k) => (
            <option key={k.lifecycleStage} value={k.lifecycleStage}>{formatEnumLabel(k.lifecycleStage)} ({k.count})</option>
          ))}
        </Select>
      </div>

      {data && data.items.length === 0 ? (
        <EmptyState icon={Workflow} title="No CRM records yet" description="Records appear here as applicants register or leads convert." />
      ) : data ? (
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="pb-2">CRM Code</th>
                  <th className="pb-2">Applicant</th>
                  <th className="pb-2">Lifecycle Stage</th>
                  <th className="pb-2">Priority</th>
                  <th className="pb-2">Assigned To</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Last Activity</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="py-2"><Link href={`/admin/crm/${r.id}`} className="font-medium text-primary hover:underline">{r.crmCode}</Link></td>
                    <td className="py-2">{r.profile.fullName} <span className="text-muted">({r.profile.profileCode})</span></td>
                    <td className="py-2"><Badge variant="info">{formatEnumLabel(r.lifecycleStage)}</Badge></td>
                    <td className="py-2">{formatEnumLabel(r.priority)}</td>
                    <td className="py-2">{r.assignedStaff?.name ?? <span className="text-muted">Unassigned</span>}</td>
                    <td className="py-2">{formatEnumLabel(r.assignmentStatus)}</td>
                    <td className="py-2 text-muted">{timeAgo(r.lastActivityAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
