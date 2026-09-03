import { MatchScore } from "@/components/ui/match-score";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";

export interface MatchCandidate {
  profile: {
    id: string;
    profileCode: string;
    fullName: string;
    age: number;
    city: string;
    country: string;
    education: string | null;
    profession: string | null;
    status: string;
  };
  total: number;
  tier: string;
  tierLabel: string;
  reasons: string[];
  differences: string[];
}

export function MatchCard({ match, onCompare }: { match: MatchCandidate; onCompare: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <MatchScore score={match.total} tier={match.tier} tierLabel={match.tierLabel} />
        <div className="flex-1 min-w-0">
          <p className="font-medium">{match.profile.fullName}</p>
          <p className="text-xs text-muted">
            {match.profile.profileCode} &middot; {match.profile.age} yrs &middot; {match.profile.city}, {match.profile.country}
          </p>
          <div className="mt-1">
            <StatusBadge status={match.profile.status} />
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={onCompare}>
          Compare
        </Button>
      </CardContent>
    </Card>
  );
}
