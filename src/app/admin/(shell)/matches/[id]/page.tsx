"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  Check,
  X,
  AlertTriangle,
  Minus,
  CheckCircle2,
  XCircle,
  ThumbsUp,
  ThumbsDown,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/form";
import { MatchScore } from "@/components/ui/match-score";
import { useToast } from "@/components/ui/toast";
import { formatCurrency, formatHeight, formatDateTime } from "@/lib/utils";
import type { ProfileDetailDto } from "@/lib/serializers";
import type { CompatibilityStatus } from "@/lib/matching";

interface CategoryRow {
  category: string;
  label: string;
  score: number;
  status: CompatibilityStatus;
  reason: string;
  hardRequirementFailed: boolean;
}

interface MatchAnalysis {
  id: string;
  status: string;
  recommendation: string | null;
  score: number;
  tier: string;
  tierLabel: string;
  direction: { aToB: number; bToA: number };
  breakdown: CategoryRow[];
  algorithmVersion: string;
  previousScore: number | null;
  recalculatedAt: string | null;
  createdAt: string;
  createdByName: string | null;
  profileA: ProfileDetailDto;
  profileB: ProfileDetailDto;
}

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

function CompatIndicator({ status }: { status: CompatibilityStatus }) {
  if (status === "compatible") return <Check className="h-4 w-4 shrink-0 text-success" aria-label="Strong match" />;
  if (status === "partial") return <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-label="Partial match" />;
  if (status === "incompatible") return <X className="h-4 w-4 shrink-0 text-danger" aria-label="Conflict" />;
  return <Minus className="h-4 w-4 shrink-0 text-muted" aria-label="Not provided" />;
}

function ProfileSummary({ profile, title }: { profile: ProfileDetailDto; title: string }) {
  return (
    <div className="flex-1 space-y-1.5 text-sm">
      <p className="text-xs uppercase tracking-wide text-muted">{title}</p>
      <Link href={`/admin/profiles/${profile.id}`} className="text-base font-semibold text-primary hover:underline">
        {profile.fullName}
      </Link>
      <p className="text-xs text-muted">{profile.profileCode}</p>
      <p>
        {profile.age} years · {formatHeight(profile.heightCm)}
      </p>
      <p>
        {[profile.area, profile.city].filter(Boolean).join(", ")}, {profile.country}
      </p>
      <p>{profile.education?.level ?? "—"}</p>
      <p>{profile.profession?.profession ?? "—"}</p>
      <p>{formatCurrency(profile.profession?.monthlyIncome)}</p>
    </div>
  );
}

export default function MatchAnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { show } = useToast();
  const [data, setData] = useState<MatchAnalysis | null>(null);
  const [recommendation, setRecommendation] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [recalcReason, setRecalcReason] = useState<string | null>(null);

  function load() {
    fetch(`/api/admin/matches/${id}`)
      .then((r) => r.json())
      .then((json) => {
        setData(json);
        setRecommendation(json.recommendation ?? "");
      });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function setMatchStatus(status: string) {
    setUpdatingStatus(true);
    try {
      const res = await fetch(`/api/admin/matches/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
      show(status === "APPROVED" ? "Match approved" : "Match rejected", "success");
      load();
    } catch {
      show("Could not update match status.", "error");
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function saveDecision() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/matches/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recommendation: recommendation || undefined, note: note || undefined }),
      });
      if (!res.ok) throw new Error();
      show("Match decision saved", "success");
      setNote("");
      load();
    } catch {
      show("Could not save match decision.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function recalculate() {
    setRecalculating(true);
    try {
      const res = await fetch(`/api/admin/matches/${id}/recalculate`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error();
      setRecalcReason(json.reason);
      show("Match recalculated", "success");
      load();
    } catch {
      show("Could not recalculate match.", "error");
    } finally {
      setRecalculating(false);
    }
  }

  if (!data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  const excludedByHardRequirement = data.breakdown.some((r) => r.hardRequirementFailed);
  const reasons = data.breakdown.filter((r) => r.status === "compatible");
  const differences = data.breakdown.filter((r) => r.status === "incompatible" || r.status === "partial");
  const customA = data.profileA.preference?.additionalExpectations || data.profileA.preference?.otherFamilyRequirements;
  const customB = data.profileB.preference?.additionalExpectations || data.profileB.preference?.otherFamilyRequirements;

  return (
    <div className="space-y-6">
      <Link href="/admin/matches" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Match History
      </Link>

      <div>
        <h1 className="font-heading text-2xl font-semibold">Match Analysis</h1>
        <p className="text-sm text-muted">
          {data.profileA.fullName} <span className="text-xs">vs</span> {data.profileB.fullName} — a Compatibility Suggestion for admin
          review, never a guaranteed match.
        </p>
      </div>

      {excludedByHardRequirement && (
        <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          <AlertTriangle className="h-4 w-4 shrink-0" /> HARD REQUIREMENT NOT MET — one or more Must-Have preferences are not satisfied.
        </div>
      )}

      <Card>
        <CardContent className="flex flex-col items-center gap-4 sm:flex-row sm:justify-around">
          <MatchScore score={data.score} tier={data.tier} tierLabel={data.tierLabel} />
          <div className="grid grid-cols-3 gap-6 text-center text-sm">
            <div>
              <p className="text-xs text-muted">Profile A → B</p>
              <p className="text-lg font-semibold">{data.direction.aToB}%</p>
            </div>
            <div>
              <p className="text-xs text-muted">Profile B → A</p>
              <p className="text-lg font-semibold">{data.direction.bToA}%</p>
            </div>
            <div>
              <p className="text-xs text-muted">Mutual Compatibility</p>
              <p className="text-lg font-semibold text-primary">{data.score}%</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex gap-6 overflow-x-auto py-4">
          <ProfileSummary profile={data.profileA} title="Profile A" />
          <div className="w-px shrink-0 bg-border" />
          <ProfileSummary profile={data.profileB} title="Profile B" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Compatibility Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          {data.breakdown.map((row) => (
            <div key={row.category} className="py-2.5">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 font-medium">
                  <CompatIndicator status={row.status} /> {row.label}
                  {row.hardRequirementFailed && <span className="text-xs text-danger">(Must Have not met)</span>}
                </span>
                <span className="text-muted">{row.status === "unknown" ? "—" : `${row.score}%`}</span>
              </div>
              <div className="mt-1.5 h-2 rounded-full bg-surface-muted">
                <div
                  className={
                    "h-2 rounded-full " +
                    (row.status === "compatible"
                      ? "bg-success"
                      : row.status === "partial"
                        ? "bg-warning"
                        : row.status === "incompatible"
                          ? "bg-danger"
                          : "bg-muted")
                  }
                  style={{ width: row.status === "unknown" ? "0%" : `${Math.max(4, row.score)}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-muted">{row.reason}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Why This Match?</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm">
              {reasons.length === 0 && <li className="text-muted">No strong compatibility signals.</li>}
              {reasons.map((r) => (
                <li key={r.category} className="flex items-start gap-1.5">
                  <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-success" /> {r.label}: {r.reason}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Potential Differences</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm">
              {differences.length === 0 && <li className="text-muted">No notable differences.</li>}
              {differences.map((d) => (
                <li key={d.category} className="flex items-start gap-1.5">
                  <XCircle className="h-4 w-4 mt-0.5 shrink-0 text-warning" /> {d.label}: {d.reason}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {(customA || customB) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Custom Requirements (Not Scored)</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted mb-1">{data.profileA.fullName}</p>
              <p className="text-sm">{customA || "—"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted mb-1">{data.profileB.fullName}</p>
              <p className="text-sm">{customB || "—"}</p>
            </div>
            <p className="sm:col-span-2 text-xs text-muted">
              Free-text requirements are shown for admin judgment only — they are never algorithmically scored.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Match History &amp; Algorithm</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted">
            Algorithm Version: <span className="font-medium text-foreground">{data.algorithmVersion}</span> · Created{" "}
            {formatDateTime(data.createdAt)} {data.createdByName ? `by ${data.createdByName}` : ""}
          </p>
          {data.previousScore != null && (
            <p className="rounded-lg bg-surface-muted p-3">
              <span className="font-medium">Previous Score:</span> {data.previousScore}% →{" "}
              <span className="font-medium">New Score:</span> {data.score}%
              {data.recalculatedAt && <span className="text-muted"> (recalculated {formatDateTime(data.recalculatedAt)})</span>}
            </p>
          )}
          {recalcReason && <p className="text-xs text-muted">{recalcReason}</p>}
          <Button size="sm" variant="outline" onClick={recalculate} disabled={recalculating}>
            {recalculating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Recalculate Match
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Admin Review</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted">
            Match status: {STATUS_LABEL[data.status] ?? data.status} — final matchmaking decisions remain with the admin and the
            individuals/families involved.
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
                disabled={updatingStatus || data.status === "REJECTED"}
              >
                <ThumbsDown className="h-4 w-4" /> Reject
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() => setMatchStatus("APPROVED")}
                disabled={updatingStatus || data.status === "APPROVED"}
              >
                <ThumbsUp className="h-4 w-4" /> Approve
              </Button>
            </div>
          </div>
          <Field label="Private Admin Note" htmlFor="matchNote">
            <Textarea id="matchNote" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Visible to admins only." />
          </Field>
          <Button size="sm" onClick={saveDecision} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save Decision
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
