"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Loader2, Handshake, ThumbsUp, ThumbsDown } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { MatchScore } from "@/components/ui/match-score";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatCurrency, formatEnumLabel, formatHeight } from "@/lib/utils";
import type { ProfileDetailDto } from "@/lib/serializers";
import type { MatchCandidate } from "@/components/admin/match-card";

function recommendation(score: number): { label: string; tone: string } {
  if (score >= 85) return { label: "Strong Match", tone: "text-success" };
  if (score >= 70) return { label: "Good Match", tone: "text-accent" };
  if (score >= 50) return { label: "Needs Review", tone: "text-warning" };
  return { label: "Not Recommended", tone: "text-danger" };
}

const STATUS_LABEL: Record<string, string> = {
  SUGGESTED: "Suggested",
  REVIEWED: "Reviewed",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  PROPOSAL_CREATED: "Proposal Created",
  CLOSED: "Closed",
};

function ProfileColumn({ profile, title }: { profile: ProfileDetailDto | null; title: string }) {
  if (!profile) {
    return (
      <div className="flex flex-1 items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted" />
      </div>
    );
  }
  return (
    <div className="flex-1 space-y-2 text-sm">
      <p className="text-xs uppercase tracking-wide text-muted">{title}</p>
      <p className="font-semibold text-base">{profile.fullName}</p>
      <p className="text-xs text-muted">{profile.profileCode}</p>
      <div className="space-y-1 pt-2">
        <p>{profile.age} years &middot; {formatHeight(profile.heightCm)}</p>
        <p>{[profile.area, profile.city].filter(Boolean).join(", ")}, {profile.country}</p>
        <p>{profile.education?.level ?? "—"}</p>
        <p>{profile.profession?.profession ?? "—"}</p>
        <p>{formatCurrency(profile.profession?.monthlyIncome)}</p>
        <p>{profile.family?.familyType ? formatEnumLabel(profile.family.familyType) : "—"} family</p>
      </div>
    </div>
  );
}

export function CompareModal({
  open,
  onClose,
  seekerId,
  match,
  onProposalCreated,
}: {
  open: boolean;
  onClose: () => void;
  seekerId: string;
  match: MatchCandidate | null;
  onProposalCreated: () => void;
}) {
  const { show } = useToast();
  const [seeker, setSeeker] = useState<ProfileDetailDto | null>(null);
  const [candidate, setCandidate] = useState<ProfileDetailDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [matchRecord, setMatchRecord] = useState<{ id: string; status: string } | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  useEffect(() => {
    if (!open || !match) return;
    setSeeker(null);
    setCandidate(null);
    setMatchRecord(null);
    fetch(`/api/admin/profiles/${seekerId}`).then((r) => r.json()).then(setSeeker);
    fetch(`/api/admin/profiles/${match.profile.id}`).then((r) => r.json()).then(setCandidate);
    // Persist this scored candidate as a real Match record so it has an id
    // to hang status/recommendation/proposal linkage off of (spec §31/§33).
    fetch(`/api/admin/profiles/${seekerId}/matches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId: match.profile.id }),
    })
      .then((r) => r.json())
      .then((m) => setMatchRecord({ id: m.id, status: m.status }));
  }, [open, match, seekerId]);

  if (!match) return null;
  const rec = recommendation(match.total);

  async function setMatchStatus(status: string) {
    if (!matchRecord) return;
    setUpdatingStatus(true);
    try {
      const res = await fetch(`/api/admin/matches/${matchRecord.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
      const updated = await res.json();
      setMatchRecord({ id: updated.id, status: updated.status });
      show(status === "APPROVED" ? "Match approved" : "Match rejected", "success");
    } catch {
      show("Could not update match status.", "error");
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function createProposal() {
    if (!match) return;
    setCreating(true);
    try {
      const res = await fetch("/api/admin/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileAId: seekerId, profileBId: match.profile.id, matchId: matchRecord?.id }),
      });
      if (!res.ok) throw new Error();
      show("Proposal created", "success");
      onProposalCreated();
      onClose();
    } catch {
      show("Could not create proposal.", "error");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Match Comparison" className="max-w-2xl">
      <div className="flex justify-center mb-4">
        <MatchScore score={match.total} tier={match.tier} tierLabel={match.tierLabel} />
      </div>

      <div className="flex gap-6 border-y border-border py-4">
        <ProfileColumn profile={seeker} title="Profile A" />
        <div className="w-px bg-border" />
        <ProfileColumn profile={candidate} title="Profile B" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 pt-4">
        <div>
          <p className="text-sm font-medium mb-2">Why this match?</p>
          <ul className="space-y-1.5 text-sm">
            {match.reasons.length === 0 && <li className="text-muted">No strong compatibility signals.</li>}
            {match.reasons.map((r) => (
              <li key={r} className="flex items-start gap-1.5">
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-success" /> {r}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-sm font-medium mb-2">Potential Differences</p>
          <ul className="space-y-1.5 text-sm">
            {match.differences.length === 0 && <li className="text-muted">No notable differences.</li>}
            {match.differences.map((d) => (
              <li key={d} className="flex items-start gap-1.5">
                <XCircle className="h-4 w-4 mt-0.5 shrink-0 text-warning" /> {d}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className={`font-semibold ${rec.tone}`}>Admin Recommendation: {rec.label}</p>
          <p className="text-xs text-muted">
            Match status: {matchRecord ? STATUS_LABEL[matchRecord.status] ?? matchRecord.status : "—"} &middot; a suggested pairing, not a guaranteed match — final decisions rest with the admin.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setMatchStatus("REJECTED")}
            disabled={!matchRecord || updatingStatus || matchRecord.status === "REJECTED"}
          >
            <ThumbsDown className="h-4 w-4" /> Reject
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setMatchStatus("APPROVED")}
            disabled={!matchRecord || updatingStatus || matchRecord.status === "APPROVED"}
          >
            <ThumbsUp className="h-4 w-4" /> Approve
          </Button>
          <Button size="sm" onClick={createProposal} disabled={creating}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Handshake className="h-4 w-4" />} Create Proposal
          </Button>
        </div>
      </div>
    </Modal>
  );
}
