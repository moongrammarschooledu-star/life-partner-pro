"use client";

import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { MatchCard, type MatchCandidate } from "@/components/admin/match-card";
import { CompareModal } from "@/components/admin/compare-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

export function MatchesTab({ profileId }: { profileId: string }) {
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
            <MatchCard key={m.profile.id} match={m} onCompare={() => setSelected(m)} />
          ))}
        </div>
      )}

      <CompareModal open={!!selected} onClose={() => setSelected(null)} seekerId={profileId} match={selected} onProposalCreated={load} />
    </div>
  );
}
