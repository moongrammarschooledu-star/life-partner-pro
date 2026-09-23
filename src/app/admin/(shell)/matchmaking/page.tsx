"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, ArrowRight, ShieldAlert, CheckCircle2, HelpCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProfilePicker, type PickedProfile } from "@/components/admin/matching/profile-picker";
import { useToast } from "@/components/ui/toast";
import { formatEnumLabel } from "@/lib/utils";

interface ExplainableCandidate {
  candidate: { id: string; profileCode: string; fullName: string; age: number; city: string; education: string | null; profession: string | null; photoUrl: string | null };
  match: { total: number; tier: string; tierLabel: string; breakdown: Array<{ category: string; label: string; status: string; reason: string }>; failedHardRequirements: string[] };
  hardRequirementNotMet: boolean;
  priorityLabels: Record<string, string>;
  missingInformation: string[];
}

// STEP 20 §27 — Matchmaking Workspace: Select Profile -> Find Candidates ->
// Review Compatibility -> Shortlist -> Proposal. Orchestrates existing
// pieces (ProfilePicker, the mutual-matches search service built on STEP 6's
// scoreMatch(), and the existing proposal-creation route) rather than
// introducing a new proposal code path.
export default function MatchmakingWorkspacePage() {
  const { show } = useToast();
  const [source, setSource] = useState<PickedProfile | null>(null);
  const [candidates, setCandidates] = useState<ExplainableCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  async function findCandidates() {
    if (!source) return;
    setBusy(true);
    setCandidates(null);
    try {
      const res = await fetch("/api/admin/search/mutual-matches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceProfileId: source.id }) });
      const data = await res.json();
      if (!res.ok) {
        show(data.error ?? "Could not find candidates.", "error");
        return;
      }
      setCandidates(data.items);
    } finally {
      setBusy(false);
    }
  }

  async function createShortlistFromSelection() {
    if (!source || selected.size === 0) return;
    const res = await fetch("/api/admin/search/shortlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `${source.fullName} — Matchmaking Shortlist`, sourceProfileId: source.id, profileIds: [...selected] }),
    });
    if (res.ok) show("Shortlist created.", "success");
    else show("Could not create shortlist.", "error");
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Reuses the existing, already-governed POST /api/admin/proposals route
  // directly (the same call src/components/admin/matching/match-detail-panel.tsx
  // makes) — no new proposal-creation code path (plan decision 11).
  async function createProposal(candidateId: string) {
    if (!source) return;
    const res = await fetch("/api/admin/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileAId: source.id, profileBId: candidateId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      show(data.error ?? "Could not create proposal.", "error");
      return;
    }
    show("Proposal created.", "success");
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Matchmaking Workspace</h1>
        <p className="text-sm text-muted">Select a profile → find mutual candidates → review compatibility → shortlist → proposal.</p>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4">
        <p className="mb-2 text-sm font-medium">1. Select Profile</p>
        <ProfilePicker selected={source} onSelect={(p) => { setSource(p); setCandidates(null); setSelected(new Set()); }} />
        {source && (
          <Button size="sm" className="mt-3" onClick={findCandidates} disabled={busy}>
            {busy ? "Finding candidates…" : "Find Mutual Candidates"} <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {busy && <div className="flex h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>}

      {candidates && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">2. Review Compatibility ({candidates.length} candidate{candidates.length === 1 ? "" : "s"})</p>
            {selected.size > 0 && (
              <div className="flex gap-2">
                <Link href={`/admin/candidate-discovery/compare?ids=${[...selected].join(",")}`} className="text-sm font-medium text-primary hover:underline self-center">Compare Selected</Link>
                <Button size="sm" variant="outline" onClick={createShortlistFromSelection}>Shortlist Selected</Button>
              </div>
            )}
          </div>

          {candidates.length === 0 && <p className="text-sm text-muted">No candidates found with the current criteria. Try reviewing this profile&apos;s partner preferences.</p>}

          {candidates.map((c) => (
            <div key={c.candidate.id} className={`rounded-xl border p-4 ${c.hardRequirementNotMet ? "border-danger/40 bg-danger/5" : "border-border bg-surface"}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <input type="checkbox" checked={selected.has(c.candidate.id)} onChange={() => toggle(c.candidate.id)} className="mt-1" />
                  <div>
                    <p className="font-mono text-xs text-muted">{c.candidate.profileCode}</p>
                    <p className="font-medium">{c.candidate.fullName} · {c.candidate.age}</p>
                    <p className="text-xs text-muted">{c.candidate.city} · {c.candidate.education ?? "—"} · {c.candidate.profession ?? "—"}</p>
                  </div>
                </div>
                <div className="text-right">
                  <Badge variant={c.match.total >= 80 ? "success" : c.match.total >= 50 ? "warning" : "danger"}>{c.match.tierLabel} — {c.match.total}%</Badge>
                  {c.hardRequirementNotMet && (
                    <p className="mt-1 flex items-center gap-1 text-xs font-medium text-danger"><ShieldAlert className="h-3.5 w-3.5" /> Hard Requirement Not Met: {c.match.failedHardRequirements.join(", ")}</p>
                  )}
                </div>
              </div>

              <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
                {c.match.breakdown.map((b) => (
                  <div key={b.category} className="flex items-center gap-2 text-xs">
                    {b.status === "compatible" ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : b.status === "unknown" ? <HelpCircle className="h-3.5 w-3.5 text-muted" /> : <ShieldAlert className="h-3.5 w-3.5 text-warning" />}
                    <span className="font-medium">{b.label}:</span>
                    <span className="text-muted">{b.status === "unknown" ? "Insufficient Information" : b.status === "compatible" ? "Match" : b.status === "partial" ? "Partial Match" : "Not Match"}</span>
                    {c.priorityLabels[b.category] && <Badge variant="muted">{formatEnumLabel(c.priorityLabels[b.category])}</Badge>}
                  </div>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-medium">
                <Link href={`/admin/profiles/${c.candidate.id}`} className="text-primary hover:underline">View Profile</Link>
                <Button size="sm" variant="outline" onClick={() => createProposal(c.candidate.id)}>Create Proposal</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
