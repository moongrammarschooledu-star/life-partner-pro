import { prisma } from "@/lib/prisma";
import { FEATURE_FLAG_DEFAULTS } from "@/lib/ops/feature-flag-defs";
import { ServiceUnavailableError } from "@/lib/ops/system-control";
import { evaluateFlag, type FlagRule, type FlagSubject, type FlagTarget } from "@/lib/platform/flag-eval";

// Server-side flag evaluation (spec §28). 30 s per-instance cache — a toggle
// reaches every serverless instance within ~30 s (disclosed). A database
// failure returns the registry default (enabled): flags are for controlled
// disabling, never a reason to take the product down on a monitoring hiccup.
//
// STEP 36: a flag also has a state and a rollout rule. isFeatureEnabled(key) is the GLOBAL question ("is it on for everyone?") and answers exactly as
// before: true only in state ENABLED. A rollout is asked per subject with isFeatureEnabledFor(key, subject).

const TTL_MS = 30_000;
let cache: { flags: Record<string, boolean>; rules: Record<string, FlagRule>; at: number } | null = null;

export function invalidateFeatureFlags(): void {
  cache = null;
}

async function load() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  const flags: Record<string, boolean> = { ...FEATURE_FLAG_DEFAULTS };
  const rules: Record<string, FlagRule> = {};
  try {
    for (const row of await prisma.featureFlag.findMany()) {
      // `enabled` AND state: during a rolling deploy an older instance may still write only `enabled`; the more restrictive of the two wins.
      flags[row.key] = row.enabled && row.state === "ENABLED";
      rules[row.key] = { state: row.state, rolloutPercent: row.rolloutPercent, targets: Array.isArray(row.targets) ? (row.targets as unknown as FlagTarget[]) : [] };
    }
    const settings = await prisma.appSettings.findUnique({ where: { id: 1 }, select: { paymentsEnabled: true } });
    flags["payments.enabled"] = settings?.paymentsEnabled ?? false;
  } catch {
    return { flags: { ...FEATURE_FLAG_DEFAULTS }, rules: {}, at: Date.now() };
  }
  cache = { flags, rules, at: Date.now() };
  return cache;
}

export async function isFeatureEnabled(key: string): Promise<boolean> {
  const { flags } = await load();
  return flags[key] ?? true;
}

/** Per-subject answer for a flag that may be in a controlled rollout. A flag that is not in ROLLOUT answers exactly like isFeatureEnabled(). */
export async function isFeatureEnabledFor(key: string, subject: FlagSubject): Promise<boolean> {
  const { flags, rules } = await load();
  const rule = rules[key];
  if (!rule || rule.state !== "ROLLOUT") return flags[key] ?? true;
  return evaluateFlag(key, rule, subject);
}

export async function getAllFeatureFlags(): Promise<Record<string, boolean>> {
  return { ...(await load()).flags };
}

export async function assertFeatureEnabled(key: string): Promise<void> {
  if (!(await isFeatureEnabled(key))) throw new ServiceUnavailableError();
}
