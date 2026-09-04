"use client";

import { cn } from "@/lib/utils";

export interface TabItem {
  value: string;
  label: string;
  count?: number;
}

export function Tabs({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: TabItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-1 overflow-x-auto border-b border-border", className)}>
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            onClick={() => onChange(tab.value)}
            className={cn(
              "shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active ? "border-primary text-primary" : "border-transparent text-muted hover:text-foreground"
            )}
          >
            {tab.label}
            {tab.count != null && (
              <span className={cn("ml-1.5 rounded-full px-1.5 py-0.5 text-xs", active ? "bg-primary/10 text-primary" : "bg-surface-muted text-muted")}>
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
