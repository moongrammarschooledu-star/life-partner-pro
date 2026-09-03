import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function StepIndicator({ current, total, titles }: { current: number; total: number; titles: string[] }) {
  return (
    <div>
      <p className="text-sm font-medium text-muted">
        Step {current + 1} of {total}
      </p>
      <h1 className="font-heading text-2xl font-semibold mt-1">{titles[current]}</h1>
      <div className="mt-4 flex gap-1.5">
        {titles.map((title, i) => (
          <div
            key={title}
            className={cn(
              "h-1.5 flex-1 rounded-full",
              i < current ? "bg-primary" : i === current ? "bg-primary/60" : "bg-border"
            )}
          />
        ))}
      </div>
      <div className="mt-3 hidden sm:flex justify-between text-xs text-muted">
        {titles.map((title, i) => (
          <span key={title} className={cn("flex items-center gap-1", i === current && "text-foreground font-medium")}>
            {i < current && <Check className="h-3 w-3 text-primary" />}
            {title}
          </span>
        ))}
      </div>
    </div>
  );
}
