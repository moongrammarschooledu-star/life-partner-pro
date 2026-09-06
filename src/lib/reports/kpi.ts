import type { KpiResult } from "@/lib/reports/types";

// Pure. Extends the dashboard's trendPercent() null-safety convention
// (spec §2's "percentage change" + "trend indicator") to a reusable shape
// used by every KPI card.
export function buildKpiResult(value: number, previousValue: number): KpiResult {
  let percentChange: number | null;
  if (previousValue === 0) {
    percentChange = value > 0 ? 100 : null;
  } else {
    percentChange = Math.round(((value - previousValue) / previousValue) * 100);
  }

  const trend: KpiResult["trend"] = percentChange == null ? null : percentChange > 0 ? "up" : percentChange < 0 ? "down" : "flat";

  return { value, previousValue, percentChange, trend };
}
