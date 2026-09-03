"use client";

import { useEffect, useState } from "react";
import { Loader2, Handshake } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/form";
import { Timeline } from "@/components/ui/timeline";
import { useToast } from "@/components/ui/toast";
import { formatEnumLabel } from "@/lib/utils";

interface ProposalItem {
  id: string;
  status: string;
  createdAt: string;
  profileA: { id: string; profileCode: string; fullName: string; gender: string };
  profileB: { id: string; profileCode: string; fullName: string; gender: string };
  events: { id: string; status: string; note: string | null; createdAt: string }[];
}

const STATUSES = ["DRAFT", "SENT", "INTERESTED", "NOT_INTERESTED", "WAITING", "MEETING", "FINALIZED", "CLOSED"];

export default function ProposalsPage() {
  const { show } = useToast();
  const [proposals, setProposals] = useState<ProposalItem[] | null>(null);

  function load() {
    fetch("/api/admin/proposals")
      .then((r) => r.json())
      .then((data) => setProposals(data.items ?? []));
  }

  useEffect(() => {
    load();
  }, []);

  async function updateStatus(id: string, status: string) {
    try {
      const res = await fetch(`/api/admin/proposals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
      show("Proposal status updated", "success");
      load();
    } catch {
      show("Could not update proposal.", "error");
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Proposals</h1>
        <p className="text-sm text-muted">Track proposals between profiles from draft through to finalization.</p>
      </div>

      {proposals === null ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      ) : proposals.length === 0 ? (
        <EmptyState icon={Handshake} title="No pending proposals" description="Create a proposal from a profile's Matches tab." />
      ) : (
        <div className="space-y-4">
          {proposals.map((p) => (
            <Card key={p.id}>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-medium">
                    {p.profileA.fullName} ({p.profileA.profileCode}) &harr; {p.profileB.fullName} ({p.profileB.profileCode})
                  </p>
                  <Select value={p.status} onChange={(e) => updateStatus(p.id, e.target.value)} className="w-auto">
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {formatEnumLabel(s)}
                      </option>
                    ))}
                  </Select>
                </div>
                <Timeline
                  items={p.events.map((e) => ({
                    id: e.id,
                    label: formatEnumLabel(e.status),
                    description: e.note ?? undefined,
                    date: e.createdAt,
                    active: e.status === p.status,
                  }))}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
