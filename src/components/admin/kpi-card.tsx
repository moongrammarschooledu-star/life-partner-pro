"use client";

import Link from "next/link";
import { ArrowUp, ArrowDown, Minus } from "lucide-react";
import type { KpiResult } from "@/lib/reports/types";

// Spec §2 — current value, previous-period comparison, %-change, trend
// indicator, in one reusable card (avoids duplicating this markup across
// Overview and Staff Performance).
export function KpiCard({ label, kpi, href }: { label: string; kpi: KpiResult; href?: string }) {
  const Icon = kpi.trend === "up" ? ArrowUp : kpi.trend === "down" ? ArrowDown : Minus;
  const trendColor = kpi.trend === "up" ? "text-success" : kpi.trend === "down" ? "text-danger" : "text-muted";

  const content = (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{kpi.value.toLocaleString()}</p>
      {kpi.percentChange != null ? (
        <p className={`mt-1 flex items-center gap-1 text-xs font-medium ${trendColor}`}>
          <Icon className="h-3 w-3" />
          {Math.abs(kpi.percentChange)}% vs previous period
        </p>
      ) : (
        <p className="mt-1 text-xs text-muted">No prior-period data</p>
      )}
    </div>
  );

  return href ? (
    <Link href={href} className="block transition-opacity hover:opacity-80">
      {content}
    </Link>
  ) : (
    content
  );
}
