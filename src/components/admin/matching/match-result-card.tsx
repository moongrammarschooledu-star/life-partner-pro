import { ShieldCheck, Eye, Scale, Handshake, X, FileSearch, AlertTriangle } from "lucide-react";
import { MatchScore } from "@/components/ui/match-score";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatEnumLabel } from "@/lib/utils";
import Link from "next/link";
import type { MatchCandidate } from "@/components/admin/matching/types";

export function MatchResultCard({
  match,
  onCompare,
  onReject,
  onDetails,
}: {
  match: MatchCandidate;
  onCompare: () => void;
  onReject: () => void;
  onDetails?: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <MatchScore score={match.total} tier={match.tier} tierLabel={match.tierLabel} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="font-medium">{match.profile.fullName}</p>
            {match.profile.verified && <ShieldCheck className="h-3.5 w-3.5 text-success" />}
          </div>
          <p className="text-xs text-muted">
            {match.profile.profileCode} · {match.profile.age} yrs · {match.profile.city}, {match.profile.country}
          </p>
          <p className="text-xs text-muted">
            {match.profile.education ?? "—"} · {match.profile.profession ?? "—"} ·{" "}
            {formatEnumLabel(match.profile.status)} · {match.profile.profileCompletion}% complete
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <StatusBadge status={match.profile.status} />
            {match.excludedByHardRequirement && (
              <span className="flex items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
                <AlertTriangle className="h-3 w-3" /> Hard Requirement Not Met
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link href={`/admin/profiles/${match.profile.id}`} className="inline-flex">
            <Button size="sm" variant="ghost">
              <Eye className="h-4 w-4" /> View
            </Button>
          </Link>
          <Button size="sm" variant="outline" onClick={onCompare}>
            <Scale className="h-4 w-4" /> Compare
          </Button>
          {onDetails && (
            <Button size="sm" variant="outline" onClick={onDetails}>
              <FileSearch className="h-4 w-4" /> Match Details
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onReject}>
            <X className="h-4 w-4" /> Reject
          </Button>
          <Button size="sm" onClick={onCompare}>
            <Handshake className="h-4 w-4" /> Propose
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
