"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { MatchResultCard } from "@/components/admin/matching/match-result-card";
import { MatchDetailPanel } from "@/components/admin/matching/match-detail-panel";
import type { MatchCandidate } from "@/components/admin/matching/types";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export function MatchesTab({ profileId }: { profileId: string }) {
  const { show } = useToast();
  const router = useRouter();
  const [matches, setMatches] = useState<MatchCandidate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<MatchCandidate | null>(null);

  function load() {
    setLoading(true);
    fetch(`/api/admin/profiles/${profileId}/matches`)
      .then((r) => r.json())
      .then((data) => setMatches(data.results ?? []))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  async function persistMatch(candidate: MatchCandidate): Promise<{ id: string }> {
    const res = await fetch(`/api/admin/profiles/${profileId}/matches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId: candidate.profile.id }),
    });
    return res.json();
  }

  async function rejectMatch(candidate: MatchCandidate) {
    try {
      const created = await persistMatch(candidate);
      await fetch(`/api/admin/matches/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "REJECTED" }),
      });
      setMatches((prev) => prev?.filter((r) => r.profile.id !== candidate.profile.id) ?? null);
      show("Match rejected", "success");
    } catch {
      show("Could not reject match.", "error");
    }
  }

  async function openDetails(candidate: MatchCandidate) {
    try {
      const created = await persistMatch(candidate);
      router.push(`/admin/matches/${created.id}`);
    } catch {
      show("Could not open match details.", "error");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">Ranked by compatibility score against this profile&apos;s stated partner preferences.</p>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          <Sparkles className="h-4 w-4" /> Refresh Matches
        </Button>
      </div>

      {loading || matches === null ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      ) : matches.length === 0 ? (
        <EmptyState icon={Sparkles} title="No suitable matches found yet" description="Try again once more profiles are verified and active." />
      ) : (
        <div className="space-y-3">
          {matches.map((m) => (
            <MatchResultCard
              key={m.profile.id}
              match={m}
              onCompare={() => setSelected(m)}
              onReject={() => rejectMatch(m)}
              onDetails={() => openDetails(m)}
            />
          ))}
        </div>
      )}

      <MatchDetailPanel
        open={!!selected}
        onClose={() => setSelected(null)}
        seekerId={profileId}
        match={selected}
        onProposalCreated={load}
        onMatchUpdated={load}
      />
    </div>
  );
}
