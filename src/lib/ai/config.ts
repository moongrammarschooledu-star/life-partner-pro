import type { AiProviderKind, AiRolloutPhase, AiStorageMode } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Singleton AI configuration (table AiConfig, id = 1). Provider secrets are NOT
// here — the external adapter reads ANTHROPIC_API_KEY from the environment.
// A database failure returns the safe default: phase DISABLED.

export interface RateLimitRule {
  limit: number;
  windowSec: number;
}

export interface AiConfigValues {
  phase: AiRolloutPhase;
  killSwitchActive: boolean;
  killSwitchReason: string | null;
  provider: AiProviderKind;
  externalProviderAllowed: boolean;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
  retryCount: number;
  dailyRequestCap: number;
  monthlyRequestCap: number;
  rateLimits: Record<string, RateLimitRule>;
  storageModes: Record<string, AiStorageMode>;
  retentionDays: number;
  cacheTtlMinutes: number;
  pilotAdminIds: string[];
  priceInputPerMTokUsd: number | null;
  priceOutputPerMTokUsd: number | null;
}

export const DEFAULT_AI_CONFIG: AiConfigValues = {
  phase: "DISABLED",
  killSwitchActive: false,
  killSwitchReason: null,
  provider: "RULES",
  externalProviderAllowed: false,
  model: "lpp-rules-v1",
  temperature: 0.2,
  maxOutputTokens: 1200,
  timeoutMs: 15_000,
  retryCount: 1,
  dailyRequestCap: 500,
  monthlyRequestCap: 10_000,
  rateLimits: {},
  storageModes: {},
  retentionDays: 30,
  cacheTtlMinutes: 60,
  pilotAdminIds: [],
  priceInputPerMTokUsd: null,
  priceOutputPerMTokUsd: null,
};

// Default per-feature limits (spec §25) — per admin, per window. Overridable
// through AiConfig.rateLimits ("<feature>" or "<ROLE>:<feature>").
export const DEFAULT_RATE_LIMITS: Record<string, RateLimitRule> = {
  PROFILE_SUMMARY: { limit: 30, windowSec: 3600 },
  DATA_QUALITY: { limit: 30, windowSec: 3600 },
  PROFILE_IMPROVEMENT: { limit: 30, windowSec: 3600 },
  MATCH_EXPLANATION: { limit: 40, windowSec: 3600 },
  COMPARE: { limit: 20, windowSec: 3600 },
  PROPOSAL_ASSISTANT: { limit: 20, windowSec: 3600 },
  COMMUNICATION_ASSISTANT: { limit: 30, windowSec: 3600 },
  FOLLOWUP_ASSISTANT: { limit: 30, windowSec: 3600 },
  COPILOT: { limit: 40, windowSec: 3600 },
  REPORT_ASSISTANT: { limit: 15, windowSec: 3600 },
};

export const DEFAULT_STORAGE_MODE: AiStorageMode = "SUMMARY_ONLY";

let cache: { value: AiConfigValues; at: number } | null = null;
const TTL_MS = 10_000;

export function invalidateAiConfig(): void {
  cache = null;
}

type Row = NonNullable<Awaited<ReturnType<typeof prisma.aiConfig.findUnique>>>;

export function fromRow(row: Row): AiConfigValues {
  return {
    phase: row.phase,
    killSwitchActive: row.killSwitchActive,
    killSwitchReason: row.killSwitchReason,
    provider: row.provider,
    externalProviderAllowed: row.externalProviderAllowed,
    model: row.model,
    temperature: row.temperature,
    maxOutputTokens: row.maxOutputTokens,
    timeoutMs: row.timeoutMs,
    retryCount: row.retryCount,
    dailyRequestCap: row.dailyRequestCap,
    monthlyRequestCap: row.monthlyRequestCap,
    rateLimits: (row.rateLimits as Record<string, RateLimitRule> | null) ?? {},
    storageModes: (row.storageModes as Record<string, AiStorageMode> | null) ?? {},
    retentionDays: row.retentionDays,
    cacheTtlMinutes: row.cacheTtlMinutes,
    pilotAdminIds: row.pilotAdminIds,
    priceInputPerMTokUsd: row.priceInputPerMTokUsd,
    priceOutputPerMTokUsd: row.priceOutputPerMTokUsd,
  };
}

export async function getAiConfig(): Promise<AiConfigValues> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  try {
    const row = await prisma.aiConfig.findUnique({ where: { id: 1 } });
    const value = row ? fromRow(row) : DEFAULT_AI_CONFIG;
    cache = { value, at: Date.now() };
    return value;
  } catch {
    return DEFAULT_AI_CONFIG;
  }
}

export function storageModeFor(config: AiConfigValues, feature: string): AiStorageMode {
  return config.storageModes[feature] ?? DEFAULT_STORAGE_MODE;
}

export function rateLimitFor(config: AiConfigValues, role: string, feature: string): RateLimitRule {
  return config.rateLimits[`${role}:${feature}`] ?? config.rateLimits[feature] ?? DEFAULT_RATE_LIMITS[feature] ?? { limit: 20, windowSec: 3600 };
}
