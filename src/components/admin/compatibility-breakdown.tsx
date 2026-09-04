import { Check, X, AlertTriangle, Minus } from "lucide-react";
import type { CompatibilityStatus } from "@/lib/matching";

export interface CompatibilityRow {
  category: string;
  label: string;
  score: number; // 0..1 fraction
  status: CompatibilityStatus;
  reason: string;
  hardRequirementFailed: boolean;
}

// Shared by the Match Analysis page and the Proposal Detail page so both
// render category breakdowns identically instead of duplicating the
// ✓/⚠/✕/— indicator + progress-bar markup.
export function CompatIndicator({ status }: { status: CompatibilityStatus }) {
  if (status === "compatible") return <Check className="h-4 w-4 shrink-0 text-success" aria-label="Strong match" />;
  if (status === "partial") return <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-label="Partial match" />;
  if (status === "incompatible") return <X className="h-4 w-4 shrink-0 text-danger" aria-label="Conflict" />;
  return <Minus className="h-4 w-4 shrink-0 text-muted" aria-label="Not provided" />;
}

export function CompatibilityBreakdownList({ breakdown }: { breakdown: CompatibilityRow[] }) {
  return (
    <div className="divide-y divide-border">
      {breakdown.map((row) => {
        const pct = Math.round(row.score * 100);
        return (
          <div key={row.category} className="py-2.5">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-1.5 font-medium">
                <CompatIndicator status={row.status} /> {row.label}
                {row.hardRequirementFailed && <span className="text-xs text-danger">(Must Have not met)</span>}
              </span>
              <span className="text-muted">{row.status === "unknown" ? "—" : `${pct}%`}</span>
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
                style={{ width: row.status === "unknown" ? "0%" : `${Math.max(4, pct)}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-muted">{row.reason}</p>
          </div>
        );
      })}
    </div>
  );
}
