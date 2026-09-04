"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Handshake } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn, formatDate } from "@/lib/utils";

interface ProposalItem {
  id: string;
  status: string;
  createdAt: string;
  profileA: { id: string; profileCode: string; fullName: string; gender: string };
  profileB: { id: string; profileCode: string; fullName: string; gender: string };
  events: { id: string; status: string; note: string | null; createdAt: string }[];
}

const TABS = ["All", "DRAFT", "SENT", "INTERESTED", "NOT_INTERESTED", "WAITING", "MEETING", "FINALIZED", "CLOSED"];

export default function ProposalsPage() {
  const [proposals, setProposals] = useState<ProposalItem[] | null>(null);
  const [tab, setTab] = useState("All");

  useEffect(() => {
    fetch("/api/admin/proposals")
      .then((r) => r.json())
      .then((data) => setProposals(data.items ?? []));
  }, []);

  const filtered = useMemo(() => {
    if (!proposals) return [];
    return tab === "All" ? proposals : proposals.filter((p) => p.status === tab);
  }, [proposals, tab]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Proposals</h1>
        <p className="text-sm text-muted">Track proposals between profiles from draft through to finalization.</p>
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-surface p-1">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              tab === t ? "bg-primary text-primary-foreground" : "text-muted hover:bg-surface-muted"
            )}
          >
            {t === "All" ? "All" : t.replaceAll("_", " ")}
            {proposals && t !== "All" && (
              <span className="ml-1.5 text-xs opacity-70">{proposals.filter((p) => p.status === t).length}</span>
            )}
          </button>
        ))}
      </div>

      {proposals === null ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={Handshake} title="No proposals in this status" description="Create a proposal from a profile's Matches tab." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="p-3">Profile A</th>
                <th className="p-3">Profile B</th>
                <th className="p-3">Status</th>
                <th className="p-3">Created</th>
                <th className="p-3">Last Update</th>
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
                  <td className="p-3">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="p-3 text-muted">{formatDate(p.createdAt)}</td>
                  <td className="p-3 text-muted">{formatDate(p.events[p.events.length - 1]?.createdAt ?? p.createdAt)}</td>
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
