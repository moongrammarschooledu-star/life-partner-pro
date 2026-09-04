"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Sparkles } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Tabs } from "@/components/ui/tabs";
import { formatDate, formatEnumLabel } from "@/lib/utils";

interface MatchItem {
  id: string;
  status: string;
  recommendation: string | null;
  score: number;
  algorithmVersion: string;
  createdAt: string;
  profileA: { id: string; profileCode: string; fullName: string; gender: string };
  profileB: { id: string; profileCode: string; fullName: string; gender: string };
  createdBy: { name: string } | null;
}

const STATUSES = ["SUGGESTED", "REVIEWED", "APPROVED", "REJECTED", "PROPOSAL_CREATED", "CLOSED"];
const STATUS_VARIANT: Record<string, "success" | "warning" | "danger" | "info" | "muted" | "default"> = {
  SUGGESTED: "muted",
  REVIEWED: "info",
  APPROVED: "success",
  REJECTED: "danger",
  PROPOSAL_CREATED: "default",
  CLOSED: "muted",
};

export default function MatchHistoryPage() {
  const [matches, setMatches] = useState<MatchItem[] | null>(null);
  const [tab, setTab] = useState("all");

  useEffect(() => {
    fetch("/api/admin/matches")
      .then((r) => r.json())
      .then((data) => setMatches(data.items ?? []));
  }, []);

  const filtered = useMemo(() => {
    if (!matches) return [];
    return tab === "all" ? matches : matches.filter((m) => m.status === tab);
  }, [matches, tab]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Match History</h1>
        <p className="text-sm text-muted">
          Every compatibility match ever generated, for auditing — a Compatibility Suggestion for admin review, never a
          guaranteed outcome.
        </p>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "all", label: "All", count: matches?.length },
          ...STATUSES.map((s) => ({ value: s, label: formatEnumLabel(s), count: matches?.filter((m) => m.status === s).length })),
        ]}
      />

      {matches === null ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={Sparkles} title="No matches in this status" description="Generate matches from the Matching Center." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="p-3">Profile A</th>
                <th className="p-3">Profile B</th>
                <th className="p-3">Score</th>
                <th className="p-3">Status</th>
                <th className="p-3">Recommendation</th>
                <th className="p-3">Algorithm</th>
                <th className="p-3">Created</th>
                <th className="p-3">Admin</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => (
                <tr key={m.id} className="border-b border-border last:border-0">
                  <td className="p-3">
                    {m.profileA.fullName} <span className="text-muted">({m.profileA.profileCode})</span>
                  </td>
                  <td className="p-3">
                    {m.profileB.fullName} <span className="text-muted">({m.profileB.profileCode})</span>
                  </td>
                  <td className="p-3 font-medium">{m.score}%</td>
                  <td className="p-3">
                    <Badge variant={STATUS_VARIANT[m.status] ?? "default"}>{formatEnumLabel(m.status)}</Badge>
                  </td>
                  <td className="p-3 text-muted">{m.recommendation ? formatEnumLabel(m.recommendation) : "—"}</td>
                  <td className="p-3 text-muted">{m.algorithmVersion}</td>
                  <td className="p-3 text-muted">{formatDate(m.createdAt)}</td>
                  <td className="p-3 text-muted">{m.createdBy?.name ?? "—"}</td>
                  <td className="p-3">
                    <Link href={`/admin/matches/${m.id}`} className="font-medium text-primary hover:underline">
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
