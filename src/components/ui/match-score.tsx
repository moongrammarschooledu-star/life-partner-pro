import { cn } from "@/lib/utils";

const TIER_COLOR: Record<string, string> = {
  EXCELLENT: "text-success",
  VERY_GOOD: "text-success",
  GOOD: "text-accent",
  POSSIBLE: "text-warning",
  LOW: "text-muted",
};

export function MatchScore({ score, tier, tierLabel, className }: { score: number; tier: string; tierLabel: string; className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="relative h-16 w-16 shrink-0">
        <svg viewBox="0 0 36 36" className="h-16 w-16 -rotate-90">
          <circle cx="18" cy="18" r="16" fill="none" className="stroke-border" strokeWidth="3" />
          <circle
            cx="18"
            cy="18"
            r="16"
            fill="none"
            className={cn(TIER_COLOR[tier] ?? "text-primary", "stroke-current")}
            strokeWidth="3"
            strokeDasharray={`${(score / 100) * 100.5} 100.5`}
            strokeLinecap="round"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold">{score}%</span>
      </div>
      <div>
        <p className={cn("font-semibold", TIER_COLOR[tier] ?? "text-primary")}>{tierLabel}</p>
        <p className="text-xs text-muted">Compatibility score</p>
      </div>
    </div>
  );
}
