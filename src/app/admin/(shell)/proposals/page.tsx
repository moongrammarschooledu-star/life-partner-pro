"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Handshake } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Tabs } from "@/components/ui/tabs";
import { formatDate, formatEnumLabel } from "@/lib/utils";

interface ProposalItem {
  id: string;
  status: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
  matchScore: number | null;
  createdAt: string;
  profileA: { id: string; profileCode: string; fullName: string; gender: string };
  profileB: { id: string; profileCode: string; fullName: string; gender: string };
  createdBy: { name: string } | null;
  events: { id: string; status: string; note: string | null; createdAt: string }[];
}

const STATUSES = ["DRAFT", "SENT", "INTERESTED", "NOT_INTERESTED", "WAITING", "MEETING", "FINALIZED", "CLOSED"];
const PRIORITY_VARIANT: Record<string, "danger" | "warning" | "muted"> = { HIGH: "danger", MEDIUM: "warning", LOW: "muted" };

export default function ProposalsPage() {
  const [proposals, setProposals] = useState<ProposalItem[] | null>(null);
  const [tab, setTab] = useState("all");

  useEffect(() => {
    fetch("/api/admin/proposals")
      .then((r) => r.json())
      .then((data) => setProposals(data.items ?? []));
  }, []);

  const filtered = useMemo(() => {
    if (!proposals) return [];
    return tab === "all" ? proposals : proposals.filter((p) => p.status === tab);
  }, [proposals, tab]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Proposal Management</h1>
        <p className="text-sm text-muted">Track proposals between profiles from draft through to finalization.</p>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "all", label: "All", count: proposals?.length },
          ...STATUSES.map((s) => ({ value: s, label: formatEnumLabel(s), count: proposals?.filter((p) => p.status === s).length })),
        ]}
      />

      {proposals === null ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={Handshake} title="No proposals in this status" description="Create a proposal from a profile's Matches tab or the Matching Center." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="p-3">Profile A</th>
                <th className="p-3">Profile B</th>
                <th className="p-3">Match %</th>
                <th className="p-3">Status</th>
                <th className="p-3">Priority</th>
                <th className="p-3">Created</th>
                <th className="p-3">Last Activity</th>
                <th className="p-3">Admin</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0">
                  <td className="p-3">
                    {p.profileA.fullName} <span className="text-muted">({p.profileA.profileCode})</span>
                  </td>
                  <td className="p-3">
                    {p.profileB.fullName} <span className="text-muted">({p.profileB.profileCode})</span>
                  </td>
                  <td className="p-3">{p.matchScore != null ? `${p.matchScore}%` : "—"}</td>
                  <td className="p-3">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="p-3">
                    <Badge variant={PRIORITY_VARIANT[p.priority]}>{formatEnumLabel(p.priority)}</Badge>
                  </td>
                  <td className="p-3 text-muted">{formatDate(p.createdAt)}</td>
                  <td className="p-3 text-muted">{formatDate(p.events[p.events.length - 1]?.createdAt ?? p.createdAt)}</td>
                  <td className="p-3 text-muted">{p.createdBy?.name ?? "—"}</td>
                  <td className="p-3">
                    <Link href={`/admin/proposals/${p.id}`} className="font-medium text-primary hover:underline">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
