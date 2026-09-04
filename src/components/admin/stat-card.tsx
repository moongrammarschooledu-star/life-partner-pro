import type { LucideIcon } from "lucide-react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({
  icon: Icon,
  label,
  value,
  accent,
  trendPercent,
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
  accent?: "primary" | "success" | "warning" | "info" | "danger" | "muted";
  /** Real week-over-week % change from the dashboard API, or null/undefined when no defensible trend exists — never fabricated. */
  trendPercent?: number | null;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4">
        <div
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg",
            accent === "success" && "bg-success/10 text-success",
            accent === "warning" && "bg-warning/10 text-warning",
            accent === "info" && "bg-info/10 text-info",
            accent === "danger" && "bg-danger/10 text-danger",
            accent === "muted" && "bg-surface-muted text-muted",
            (!accent || accent === "primary") && "bg-primary/10 text-primary"
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <p className="text-2xl font-semibold leading-none">{value}</p>
            {trendPercent != null && (
              <span
                className={cn(
                  "flex items-center gap-0.5 text-xs font-medium",
                  trendPercent >= 0 ? "text-success" : "text-danger"
                )}
              >
                {trendPercent >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {Math.abs(trendPercent)}%
              </span>
            )}
          </div>
          <p className="mt-1 truncate text-sm text-muted">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}
