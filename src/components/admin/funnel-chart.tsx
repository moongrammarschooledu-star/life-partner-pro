"use client";

import Link from "next/link";

// Spec §17 — the 10-stage success funnel, each stage clickable to a
// pre-filtered list page (spec §26). Never implies a guaranteed outcome.
export function FunnelChart({ stages }: { stages: { key: string; label: string; count: number; href?: string }[] }) {
  const max = Math.max(1, ...stages.map((s) => s.count));

  return (
    <div className="space-y-2">
      {stages.map((stage) => {
        const widthPercent = Math.max(6, (stage.count / max) * 100);
        const content = (
          <div className="flex items-center gap-3">
            <div className="w-40 shrink-0 text-sm text-muted">{stage.label}</div>
            <div className="h-8 flex-1 rounded-md bg-surface-muted">
              <div
                className="flex h-8 items-center justify-end rounded-md bg-primary px-2 text-sm font-medium text-primary-foreground transition-all"
                style={{ width: `${widthPercent}%` }}
              >
                {stage.count}
              </div>
            </div>
          </div>
        );
        return stage.href ? (
          <Link key={stage.key} href={stage.href} className="block rounded-md transition-opacity hover:opacity-80">
            {content}
          </Link>
        ) : (
          <div key={stage.key}>{content}</div>
        );
      })}
    </div>
  );
}
