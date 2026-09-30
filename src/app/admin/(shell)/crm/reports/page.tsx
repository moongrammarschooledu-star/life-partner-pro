"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/admin/system/shared";
import { formatEnumLabel } from "@/lib/utils";

interface ReportsResponse {
  pipelineByStage: Array<{ lifecycleStage: string; count: number }>;
  assignmentLoad: Array<{ assignedStaffId: string | null; count: number }>;
  leadsBySource: Array<{ source: string; count: number }>;
  leadsByStatus: Array<{ status: string; count: number }>;
  followupsOverdueOrBreached: number;
  followupsBreached: number;
}

function BarList({ items }: { items: Array<{ label: string; count: number }> }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div className="space-y-2">
      {items.map((i) => (
        <div key={i.label} className="space-y-0.5">
          <div className="flex justify-between text-xs"><span>{i.label}</span><span className="text-muted">{i.count}</span></div>
          <div className="h-1.5 rounded-full bg-surface-muted"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${(i.count / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

// Aggregate-only reporting (spec §19/§45) — pipeline/assignment/lead-source/
// SLA-health counts, never a per-applicant ranked list (mirrors the
// workload-not-a-ranking convention already established for /admin/team-workload).
export default function CrmReportsPage() {
  const [data, setData] = useState<ReportsResponse | null>(null);

  useEffect(() => {
    fetch("/api/admin/crm/reports", { cache: "no-store" }).then((r) => r.json()).then(setData);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/admin/crm" className="text-muted hover:text-foreground"><ArrowLeft className="h-5 w-5" /></Link>
        <div>
          <h1 className="font-heading text-2xl font-semibold">CRM Reports</h1>
          <p className="text-sm text-muted">Pipeline, assignment load, lead sources, and follow-up SLA health.</p>
        </div>
      </div>

      {!data ? (
        <div className="grid gap-3 sm:grid-cols-2"><Skeleton className="h-56" /><Skeleton className="h-56" /></div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Card title="Pipeline by Lifecycle Stage">
            <BarList items={data.pipelineByStage.map((r) => ({ label: formatEnumLabel(r.lifecycleStage), count: r.count }))} />
          </Card>
          <Card title="Leads by Source">
            <BarList items={data.leadsBySource.map((r) => ({ label: formatEnumLabel(r.source), count: r.count }))} />
          </Card>
          <Card title="Leads by Status">
            <BarList items={data.leadsByStatus.map((r) => ({ label: formatEnumLabel(r.status), count: r.count }))} />
          </Card>
          <Card title="Follow-up SLA Health">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted">Overdue or breached</span><span className="font-medium">{data.followupsOverdueOrBreached}</span></div>
              <div className="flex justify-between"><span className="text-muted">Breached</span><span className="font-medium text-danger">{data.followupsBreached}</span></div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
