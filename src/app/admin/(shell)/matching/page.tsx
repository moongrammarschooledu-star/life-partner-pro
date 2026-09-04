"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Sparkles, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { ProfilePicker, type PickedProfile } from "@/components/admin/matching/profile-picker";
import { MatchFiltersBar, emptyMatchFilters, type MatchFilters } from "@/components/admin/matching/match-filters-bar";
import { MatchResultCard } from "@/components/admin/matching/match-result-card";
import { MatchDetailPanel } from "@/components/admin/matching/match-detail-panel";
import type { MatchCandidate } from "@/components/admin/matching/types";

function sortResults(results: MatchCandidate[], sort: string, seekerCity?: string): MatchCandidate[] {
  const copy = [...results];
  switch (sort) {
    case "lowest":
      return copy.sort((a, b) => a.total - b.total);
    case "newest":
      return copy.sort((a, b) => new Date(b.profile.createdAt).getTime() - new Date(a.profile.createdAt).getTime());
    case "same_city":
      return copy.sort((a, b) => {
        const aMatch = seekerCity && a.profile.city.toLowerCase() === seekerCity.toLowerCase() ? 0 : 1;
        const bMatch = seekerCity && b.profile.city.toLowerCase() === seekerCity.toLowerCase() ? 0 : 1;
        return aMatch - bMatch || b.total - a.total;
      });
    case "age_closest": {
      const breakdown = (m: MatchCandidate) => m.breakdown.find((c) => c.category === "age")?.score ?? 0;
      return copy.sort((a, b) => breakdown(b) - breakdown(a));
    }
    case "education_closest": {
      const breakdown = (m: MatchCandidate) => m.breakdown.find((c) => c.category === "education")?.score ?? 0;
      return copy.sort((a, b) => breakdown(b) - breakdown(a));
    }
    case "profession_closest": {
      const breakdown = (m: MatchCandidate) => m.breakdown.find((c) => c.category === "profession")?.score ?? 0;
      return copy.sort((a, b) => breakdown(b) - breakdown(a));
    }
    case "highest":
    default:
      return copy.sort((a, b) => b.total - a.total);
  }
}

export default function MatchingCenterPage() {
  const { show } = useToast();
  const searchParams = useSearchParams();
  const [seeker, setSeeker] = useState<PickedProfile | null>(null);
  const [filters, setFilters] = useState<MatchFilters>(emptyMatchFilters);
  const [results, setResults] = useState<MatchCandidate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<MatchCandidate | null>(null);

  useEffect(() => {
    const seekerId = searchParams.get("seekerId");
    if (!seekerId) return;
    fetch(`/api/admin/profiles/${seekerId}`)
      .then((r) => r.json())
      .then((p) =>
        setSeeker({ id: p.id, profileCode: p.profileCode, fullName: p.fullName, age: p.age, gender: p.gender, city: p.city })
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sorted = useMemo(() => (results ? sortResults(results, filters.sort, seeker?.city) : null), [results, filters.sort, seeker?.city]);

  function findMatches() {
    if (!seeker) return;
    setLoading(true);
    const params = new URLSearchParams({ minScore: filters.minScore || "40" });
    if (filters.city) params.set("city", filters.city);
    if (filters.education) params.set("education", filters.education);
    if (filters.profession) params.set("profession", filters.profession);
    if (filters.verifiedOnly) params.set("verifiedOnly", "true");
    if (filters.activeOnly) params.set("activeOnly", "true");

    fetch(`/api/admin/profiles/${seeker.id}/matches?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => setResults(data.results ?? []))
      .finally(() => setLoading(false));
  }

  async function rejectMatch(candidate: MatchCandidate) {
    if (!seeker) return;
    try {
      const createRes = await fetch(`/api/admin/profiles/${seeker.id}/matches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId: candidate.profile.id }),
      });
      const created = await createRes.json();
      await fetch(`/api/admin/matches/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "REJECTED" }),
      });
      setResults((prev) => prev?.filter((r) => r.profile.id !== candidate.profile.id) ?? null);
      show("Match rejected", "success");
    } catch {
      show("Could not reject match.", "error");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" /> Matching Center
        </h1>
        <p className="text-sm text-muted">Find the right match — ranked by mutual, bidirectional compatibility.</p>
      </div>

      <Card>
        <CardContent className="space-y-4">
          <p className="text-sm font-medium">Select Profile</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex-1">
              <ProfilePicker selected={seeker} onSelect={setSeeker} />
            </div>
            <Button onClick={findMatches} disabled={!seeker || loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Find Best Matches
            </Button>
          </div>
        </CardContent>
      </Card>

      {seeker && results !== null && (
        <>
          <MatchFiltersBar filters={filters} onChange={setFilters} seekerCity={seeker.city} />

          <div>
            <p className="mb-3 text-sm text-muted">
              Matching results for <span className="font-medium text-foreground">{seeker.profileCode}</span> — {seeker.fullName}, {seeker.age}{" "}
              yrs, {seeker.gender === "MALE" ? "Male" : "Female"}, {seeker.city}
            </p>
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-28" />
                ))}
              </div>
            ) : sorted && sorted.length === 0 ? (
              <EmptyState icon={Sparkles} title="No matches found" description="Try lowering the minimum score or adjusting filters." />
            ) : (
              <div className="space-y-3">
                {sorted?.map((m) => (
                  <MatchResultCard key={m.profile.id} match={m} onCompare={() => setSelected(m)} onReject={() => rejectMatch(m)} />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {seeker && (
        <MatchDetailPanel
          open={!!selected}
          onClose={() => setSelected(null)}
          seekerId={seeker.id}
          match={selected}
          onProposalCreated={findMatches}
          onMatchUpdated={findMatches}
        />
      )}
    </div>
  );
}
