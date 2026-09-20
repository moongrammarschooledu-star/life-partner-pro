import { prisma } from "@/lib/prisma";
import { FEATURE_FLAG_DEFAULTS } from "@/lib/ops/feature-flag-defs";
import { ServiceUnavailableError } from "@/lib/ops/system-control";

// Server-side flag evaluation (spec §28). 30 s per-instance cache — a toggle
// reaches every serverless instance within ~30 s (disclosed). A database
// failure returns the registry default (enabled): flags are for controlled
// disabling, never a reason to take the product down on a monitoring hiccup.

const TTL_MS = 30_000;
let cache: { flags: Record<string, boolean>; at: number } | null = null;

export function invalidateFeatureFlags(): void {
  cache = null;
}

async function loadFlags(): Promise<Record<string, boolean>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.flags;
  const flags: Record<string, boolean> = { ...FEATURE_FLAG_DEFAULTS };
  try {
    for (const row of await prisma.featureFlag.findMany()) flags[row.key] = row.enabled;
    const settings = await prisma.appSettings.findUnique({ where: { id: 1 }, select: { paymentsEnabled: true } });
    flags["payments.enabled"] = settings?.paymentsEnabled ?? false;
  } catch {
    return { ...FEATURE_FLAG_DEFAULTS };
  }
  cache = { flags, at: Date.now() };
  return flags;
}

export async function isFeatureEnabled(key: string): Promise<boolean> {
  const flags = await loadFlags();
  return flags[key] ?? true;
}

export async function getAllFeatureFlags(): Promise<Record<string, boolean>> {
  return { ...(await loadFlags()) };
}

export async function assertFeatureEnabled(key: string): Promise<void> {
  if (!(await isFeatureEnabled(key))) throw new ServiceUnavailableError();
}
