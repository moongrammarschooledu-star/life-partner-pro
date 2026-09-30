"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatEnumLabel } from "@/lib/utils";

interface CrmRecordRow {
  id: string;
  crmCode: string;
  lifecycleStage: string;
  profile: { fullName: string; profileCode: string };
  assignedStaff: { name: string } | null;
}

// A read-only Kanban board grouped by lifecycle stage. Deliberately no
// drag-and-drop in this pass (a disclosed scope decision) — moving a record
// between stages always goes through /admin/crm/[id]'s Lifecycle tab, which
// validates the transition; dragging a card here would need to silently
// replicate that same validate-then-write logic with no visible feedback.
const STAGE_ORDER = [
  "REGISTERED", "PROFILE_INCOMPLETE", "PROFILE_SUBMITTED", "UNDER_REVIEW", "VERIFICATION_PENDING", "VERIFIED",
  "ACTIVE", "MATCHING", "PROPOSAL_ACTIVE", "WAITING_FOR_RESPONSE", "MUTUAL_INTEREST", "CONTACT_COORDINATION",
  "MEETING_SCHEDULED", "MEETING_COMPLETED", "FOLLOWUP", "FURTHER_DISCUSSION", "FINALIZATION_REVIEW", "FINALIZED", "MARRIED",
];

export default function CrmPipelinePage() {
  const [items, setItems] = useState<CrmRecordRow[] | null>(null);

  useEffect(() => {
    fetch("/api/admin/crm", { cache: "no-store" }).then((r) => r.json()).then((d) => setItems(d.items ?? []));
  }, []);

  const byStage = new Map<string, CrmRecordRow[]>();
  for (const item of items ?? []) {
    if (!byStage.has(item.lifecycleStage)) byStage.set(item.lifecycleStage, []);
    byStage.get(item.lifecycleStage)!.push(item);
  }
  const stagesToShow = STAGE_ORDER.filter((s) => byStage.has(s));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/admin/crm" className="text-muted hover:text-foreground"><ArrowLeft className="h-5 w-5" /></Link>
        <div>
          <h1 className="font-heading text-2xl font-semibold">Pipeline</h1>
          <p className="text-sm text-muted">Applicants grouped by lifecycle stage. Open a card to change its stage.</p>
        </div>
      </div>

      {items === null ? (
        <div className="flex gap-3 overflow-x-auto">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-64 w-64 shrink-0" />)}</div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {stagesToShow.map((stage) => (
            <div key={stage} className="w-64 shrink-0 rounded-xl border border-border bg-surface p-3">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-medium">{formatEnumLabel(stage)}</h3>
                <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-muted">{byStage.get(stage)!.length}</span>
              </div>
              <div className="space-y-2">
                {byStage.get(stage)!.map((r) => (
                  <Link key={r.id} href={`/admin/crm/${r.id}`} className="block rounded-lg border border-border bg-background p-2 text-xs hover:border-primary">
                    <div className="font-medium">{r.profile.fullName}</div>
                    <div className="text-muted">{r.crmCode}</div>
                    <div className="mt-1 text-muted">{r.assignedStaff?.name ?? "Unassigned"}</div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
