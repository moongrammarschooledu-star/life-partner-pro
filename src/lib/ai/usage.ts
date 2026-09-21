import { prisma } from "@/lib/prisma";
import type { AiConfigValues } from "@/lib/ai/config";
import type { ProviderUsage } from "@/lib/ai/providers/types";

// Spec §24/§25 — usage counting and cost. Cost is an ESTIMATE, and only when
// the provider reported token usage AND a price is configured; the built-in
// provider has no cost and reports none. Nothing is ever presented as exact.

export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
export function startOfUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function quotaExceeded(config: Pick<AiConfigValues, "dailyRequestCap" | "monthlyRequestCap">, counts: { today: number; month: number }): "DAILY" | "MONTHLY" | null {
  if (config.dailyRequestCap > 0 && counts.today >= config.dailyRequestCap) return "DAILY";
  if (config.monthlyRequestCap > 0 && counts.month >= config.monthlyRequestCap) return "MONTHLY";
  return null;
}

// Only successful, non-cached model calls count against the quota.
export async function usageCounts(now: Date = new Date()): Promise<{ today: number; month: number }> {
  const [today, month] = await Promise.all([
    prisma.aiRequest.count({ where: { createdAt: { gte: startOfUtcDay(now) }, status: { in: ["SUCCESS", "FALLBACK"] }, fromCache: false } }),
    prisma.aiRequest.count({ where: { createdAt: { gte: startOfUtcMonth(now) }, status: { in: ["SUCCESS", "FALLBACK"] }, fromCache: false } }),
  ]);
  return { today, month };
}

export function estimateCost(config: Pick<AiConfigValues, "priceInputPerMTokUsd" | "priceOutputPerMTokUsd">, usage: ProviderUsage | undefined): { costUsd: number | null; isEstimate: boolean } {
  if (!usage || usage.inputTokens == null || usage.outputTokens == null) return { costUsd: null, isEstimate: false };
  if (config.priceInputPerMTokUsd == null || config.priceOutputPerMTokUsd == null) return { costUsd: null, isEstimate: false };
  const cost = (usage.inputTokens * config.priceInputPerMTokUsd + usage.outputTokens * config.priceOutputPerMTokUsd) / 1_000_000;
  return { costUsd: Math.round(cost * 1_000_000) / 1_000_000, isEstimate: true };
}
