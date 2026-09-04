"use client";

import { useEffect, useState } from "react";
import { Check, X, AlertTriangle, Minus, Loader2, Handshake, ThumbsUp, ThumbsDown, CheckCircle2, XCircle, ShieldCheck, ShieldQuestion } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { MatchScore } from "@/components/ui/match-score";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { formatCurrency, formatEnumLabel, formatHeight } from "@/lib/utils";
import type { ProfileDetailDto } from "@/lib/serializers";
import type { MatchCandidate, CategoryResult } from "@/components/admin/matching/types";
import type { CompatibilityStatus } from "@/lib/matching";

const STATUS_LABEL: Record<string, string> = {
  SUGGESTED: "Suggested",
  REVIEWED: "Reviewed",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  PROPOSAL_CREATED: "Proposal Created",
  CLOSED: "Closed",
};

const RECOMMENDATION_OPTIONS = [
  { value: "STRONG_MATCH", label: "Strong Match" },
  { value: "GOOD_MATCH", label: "Good Match" },
  { value: "NEEDS_REVIEW", label: "Needs Review" },
  { value: "NOT_RECOMMENDED", label: "Not Recommended" },
];

const PRIORITY_OPTIONS = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
];

function CompatIndicator({ status }: { status: CompatibilityStatus }) {
  if (status === "compatible") return <Check className="h-4 w-4 shrink-0 text-success" />;
  if (status === "partial") return <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />;
  if (status === "incompatible") return <X className="h-4 w-4 shrink-0 text-danger" />;
  return <Minus className="h-4 w-4 shrink-0 text-muted" />;
}

function BreakdownRow({ row }: { row: CategoryResult }) {
  const pct = Math.round(row.score * 100);
  return (
    <div className="py-2">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5 font-medium">
          <CompatIndicator status={row.status} /> {row.label}
        </span>
        <span className="text-muted">{row.status === "unknown" ? "—" : `${pct}%`}</span>
      </div>
      <div className="mt-1.5 h-2 rounded-full bg-surface-muted">
        <div
          className={
            "h-2 rounded-full " +
            (row.status === "compatible" ? "bg-success" : row.status === "partial" ? "bg-warning" : row.status === "incompatible" ? "bg-danger" : "bg-muted")
          }
          style={{ width: row.status === "unknown" ? "0%" : `${Math.max(4, pct)}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-muted">{row.reason}</p>
    </div>
  );
}

function ProfileColumn({ profile, title }: { profile: ProfileDetailDto | null; title: string }) {
  if (!profile) {
    return (
      <div className="flex flex-1 items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted" />
      </div>
    );
  }
  return (
    <div className="flex-1 space-y-1.5 text-sm">
      <p className="text-xs uppercase tracking-wide text-muted">{title}</p>
      <p className="text-base font-semibold">{profile.fullName}</p>
      <p className="flex items-center gap-1 text-xs text-muted">
        {profile.profileCode}
        {profile.verified ? (
          <span className="inline-flex items-center gap-0.5 text-success">
            <ShieldCheck className="h-3 w-3" /> Verified
          </span>
        ) : (
          <span className="inline-flex items-center gap-0.5 text-warning">
            <ShieldQuestion className="h-3 w-3" /> Unverified
          </span>
        )}
      </p>
      <p>
        {profile.age} years · {formatHeight(profile.heightCm)}
      </p>
      <p>
        {[profile.area, profile.city].filter(Boolean).join(", ")}, {profile.country}
      </p>
      <p>{profile.education?.level ?? "—"}</p>
      <p>{profile.profession?.profession ?? "—"}</p>
      <p>{formatCurrency(profile.profession?.monthlyIncome)}</p>
      <p>{profile.family?.familyType ? formatEnumLabel(profile.family.familyType) : "—"} family</p>
    </div>
  );
}

export function MatchDetailPanel({
  open,
  onClose,
  seekerId,
  match,
  onProposalCreated,
  onMatchUpdated,
}: {
  open: boolean;
  onClose: () => void;
  seekerId: string;
  match: MatchCandidate | null;
  onProposalCreated: () => void;
  onMatchUpdated?: () => void;
}) {
  const { show } = useToast();
  const [seeker, setSeeker] = useState<ProfileDetailDto | null>(null);
  const [candidate, setCandidate] = useState<ProfileDetailDto | null>(null);
  const [matchRecord, setMatchRecord] = useState<{ id: string; status: string } | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [recommendation, setRecommendation] = useState("");
  const [note, setNote] = useState("");
  const [savingDecision, setSavingDecision] = useState(false);
  const [showProposalForm, setShowProposalForm] = useState(false);
  const [proposalPriority, setProposalPriority] = useState("MEDIUM");
  const [proposalNote, setProposalNote] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open || !match) return;
    setSeeker(null);
    setCandidate(null);
    setMatchRecord(null);
    setRecommendation("");
    setNote("");
    setShowProposalForm(false);
    setProposalNote("");
    fetch(`/api/admin/profiles/${seekerId}`).then((r) => r.json()).then(setSeeker);
    fetch(`/api/admin/profiles/${match.profile.id}`).then((r) => r.json()).then(setCandidate);
    fetch(`/api/admin/profiles/${seekerId}/matches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId: match.profile.id }),
    })
      .then((r) => r.json())
      .then((m) => setMatchRecord({ id: m.id, status: m.status }));
  }, [open, match, seekerId]);

  if (!match) return null;

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
      onMatchUpdated?.();
    } catch {
      show("Could not update match status.", "error");
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function saveDecision() {
    if (!matchRecord) return;
    setSavingDecision(true);
    try {
      const res = await fetch(`/api/admin/matches/${matchRecord.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recommendation: recommendation || undefined, note: note || undefined }),
      });
      if (!res.ok) throw new Error();
      show("Match decision saved", "success");
      setNote("");
      onMatchUpdated?.();
    } catch {
      show("Could not save match decision.", "error");
    } finally {
      setSavingDecision(false);
    }
  }

  async function createProposal() {
    if (!match) return;
    setCreating(true);
    try {
      const res = await fetch("/api/admin/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileAId: seekerId,
          profileBId: match.profile.id,
          matchId: matchRecord?.id,
          priority: proposalPriority,
          note: proposalNote || undefined,
        }),
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
    <Drawer
      open={open}
      onClose={onClose}
      title="Match Comparison"
      footer={
        showProposalForm ? (
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setShowProposalForm(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={createProposal} disabled={creating}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Handshake className="h-4 w-4" />} Confirm & Create Proposal
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-end">
            <Button size="sm" onClick={() => setShowProposalForm(true)}>
              <Handshake className="h-4 w-4" /> Create Proposal
            </Button>
          </div>
        )
      }
    >
      <div className="space-y-6">
        <div className="flex flex-col items-center gap-4 rounded-xl border border-border p-4 sm:flex-row sm:justify-around">
          <MatchScore score={match.total} tier={match.tier} tierLabel={match.tierLabel} />
          <div className="grid grid-cols-3 gap-4 text-center text-sm">
            <div>
              <p className="text-xs text-muted">A → B</p>
              <p className="text-lg font-semibold">{match.direction.aToB}%</p>
            </div>
            <div>
              <p className="text-xs text-muted">B → A</p>
              <p className="text-lg font-semibold">{match.direction.bToA}%</p>
            </div>
            <div>
              <p className="text-xs text-muted">Mutual</p>
              <p className="text-lg font-semibold text-primary">{match.total}%</p>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="flex min-w-[22rem] gap-6 border-y border-border py-4">
            <ProfileColumn profile={seeker} title="Profile A" />
            <div className="w-px shrink-0 bg-border" />
            <ProfileColumn profile={candidate} title="Profile B" />
          </div>
        </div>

        <div>
          <p className="mb-1 text-sm font-semibold">Compatibility Breakdown</p>
          <div className="divide-y divide-border">
            {match.breakdown.map((row) => (
              <BreakdownRow key={row.category} row={row} />
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
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

        <div className="rounded-xl border border-border p-4">
          <p className="text-sm font-semibold mb-3">Admin Match Decision</p>
          <p className="mb-3 text-xs text-muted">
            Match status: {matchRecord ? STATUS_LABEL[matchRecord.status] ?? matchRecord.status : "—"} — a suggested pairing, not a guaranteed
            match. Final decisions rest with the admin.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Admin Recommendation" htmlFor="recommendation">
              <Select id="recommendation" value={recommendation} onChange={(e) => setRecommendation(e.target.value)}>
                <option value="">Not set</option>
                {RECOMMENDATION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex items-end gap-2">
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() => setMatchStatus("REJECTED")}
                disabled={!matchRecord || updatingStatus || matchRecord.status === "REJECTED"}
              >
                <ThumbsDown className="h-4 w-4" /> Reject
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() => setMatchStatus("APPROVED")}
                disabled={!matchRecord || updatingStatus || matchRecord.status === "APPROVED"}
              >
                <ThumbsUp className="h-4 w-4" /> Approve
              </Button>
            </div>
          </div>
          <Field label="Private Note" htmlFor="matchNote" className="mt-3">
            <Textarea id="matchNote" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Visible to admins only." />
          </Field>
          <Button size="sm" className="mt-3" onClick={saveDecision} disabled={savingDecision || !matchRecord}>
            {savingDecision ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save Match Decision
          </Button>
        </div>

        {showProposalForm ? (
          <div className="rounded-xl border border-border p-4">
            <p className="text-sm font-semibold mb-1">Confirm Rishta Proposal</p>
            <p className="mb-3 text-xs text-muted">Review the details below before creating this proposal.</p>
            <div className="mb-3 grid gap-2 rounded-lg bg-surface-muted p-3 text-xs sm:grid-cols-2">
              <p>
                <span className="text-muted">Profile A:</span> {seeker?.fullName} ({seeker?.profileCode}) —{" "}
                {seeker?.verified ? "Verified" : "Unverified"}
              </p>
              <p>
                <span className="text-muted">Profile B:</span> {candidate?.fullName} ({candidate?.profileCode}) —{" "}
                {candidate?.verified ? "Verified" : "Unverified"}
              </p>
              <p>
                <span className="text-muted">Compatibility Score:</span> {match.total}% ({match.tierLabel})
              </p>
              <p>
                <span className="text-muted">Key Highlights:</span> {match.reasons.slice(0, 2).join("; ") || "None"}
              </p>
              <p className="sm:col-span-2">
                <span className="text-muted">Potential Differences:</span> {match.differences.slice(0, 2).join("; ") || "None"}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Priority" htmlFor="proposalPriority">
                <Select id="proposalPriority" value={proposalPriority} onChange={(e) => setProposalPriority(e.target.value)}>
                  {PRIORITY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Match Score" htmlFor="proposalScore">
                <p className="flex h-10 items-center text-sm font-medium">{match.total}%</p>
              </Field>
            </div>
            <Field label="Admin Notes" htmlFor="proposalNote" className="mt-3">
              <Textarea id="proposalNote" rows={2} value={proposalNote} onChange={(e) => setProposalNote(e.target.value)} />
            </Field>
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}
