import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http-error";
import type { CommunicationPolicyKind } from "@prisma/client";

// Versioned communication configuration (same pattern as RiskRule / ComplianceRule: a change is a NEW row, never an in-place edit).
// The code defaults below reproduce the behaviour the platform had before STEP 25 (20 messages per channel per day, no quiet hours),
// so an empty CommunicationPolicy table changes nothing.

export interface FrequencyLimit {
  perHour: number;
  perDay: number;
  perWeek: number;
}
export interface FrequencyConfig {
  security: FrequencyLimit;
  transactional: FrequencyLimit;
  marketing: FrequencyLimit;
  maxAutomatedFollowups: number;
}
export interface QuietHoursConfig {
  enabled: boolean;
  start: string; // HH:MM
  end: string; // HH:MM
  timezone: string;
  channels: Array<"SMS" | "WHATSAPP" | "EMAIL" | "IN_APP">;
  exceptionTypes: Array<"SECURITY" | "VERIFICATION" | "PAYMENT" | "PRIVACY">;
}
export interface JurisdictionDefaults {
  unresolvedTransactional: "ALLOW" | "REVIEW" | "BLOCK";
  unresolvedMarketing: "REVIEW" | "BLOCK"; // never ALLOW - the law is not guessed for marketing
  requireVerifiedContactFor: Array<"MARKETING" | "SUPPORT" | "PROPOSAL">;
}
export interface EnvironmentConfig {
  testRecipients: string[];
}

export interface PolicyConfigMap {
  FREQUENCY: FrequencyConfig;
  QUIET_HOURS: QuietHoursConfig;
  JURISDICTION_DEFAULTS: JurisdictionDefaults;
  ENVIRONMENT: EnvironmentConfig;
}

export const POLICY_DEFAULTS: PolicyConfigMap = {
  FREQUENCY: {
    security: { perHour: 20, perDay: 50, perWeek: 200 },
    transactional: { perHour: 10, perDay: 20, perWeek: 100 },
    marketing: { perHour: 1, perDay: 1, perWeek: 3 },
    maxAutomatedFollowups: 3,
  },
  QUIET_HOURS: { enabled: false, start: "21:00", end: "08:00", timezone: "Asia/Karachi", channels: ["SMS", "WHATSAPP"], exceptionTypes: ["SECURITY", "VERIFICATION"] },
  JURISDICTION_DEFAULTS: { unresolvedTransactional: "ALLOW", unresolvedMarketing: "REVIEW", requireVerifiedContactFor: ["MARKETING"] },
  ENVIRONMENT: { testRecipients: [] },
};

type DefaultsMap = PolicyConfigMap;
export type PolicyKindKey = keyof PolicyConfigMap;

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { at: number; value: unknown; version: number }>();
export function clearCommunicationPolicyCache(): void {
  cache.clear();
}

export async function getPolicy<K extends PolicyKindKey>(kind: K, policyKey = "default", jurisdictionScope = "GLOBAL"): Promise<{ config: DefaultsMap[K]; version: number }> {
  const cacheKey = `${kind}:${policyKey}:${jurisdictionScope}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { config: hit.value as DefaultsMap[K], version: hit.version };
  let config = POLICY_DEFAULTS[kind] as unknown as Record<string, unknown>;
  let version = 0;
  try {
    const now = new Date();
    const row = await prisma.communicationPolicy.findFirst({
      where: { kind: kind as CommunicationPolicyKind, policyKey, status: "ACTIVE", jurisdictionScope: { in: jurisdictionScope === "GLOBAL" ? ["GLOBAL"] : [jurisdictionScope, "GLOBAL"] }, effectiveFrom: { lte: now } },
      orderBy: { version: "desc" },
    });
    if (row) {
      const parsed = JSON.parse(row.configuration) as Record<string, unknown>;
      config = deepMerge(POLICY_DEFAULTS[kind] as unknown as Record<string, unknown>, parsed);
      version = row.version;
    }
  } catch {
    // config problems fall back to the shipped defaults - a read error never stops communication
  }
  cache.set(cacheKey, { at: Date.now(), value: config, version });
  return { config: config as unknown as DefaultsMap[K], version };
}

function deepMerge(base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (!(k in base)) continue; // unknown keys are ignored
    const b = base[k];
    if (b && typeof b === "object" && !Array.isArray(b) && v && typeof v === "object" && !Array.isArray(v)) out[k] = deepMerge(b as Record<string, unknown>, v as Record<string, unknown>);
    else if (typeof b === typeof v || (Array.isArray(b) && Array.isArray(v))) out[k] = v;
  }
  return out;
}

// ---------- validation for writes ----------

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const int = (v: unknown, max: number): boolean => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;

function validTimezone(tz: unknown): boolean {
  if (typeof tz !== "string" || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function validatePolicyConfig(kind: string, config: unknown): Record<string, unknown> {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new HttpError(422, "The policy configuration must be an object.");
  const c = config as Record<string, unknown>;
  if (kind === "FREQUENCY") {
    for (const cls of ["security", "transactional", "marketing"] as const) {
      if (c[cls] === undefined) continue;
      const l = c[cls] as Record<string, unknown>;
      if (!l || !int(l.perHour, 1000) || !int(l.perDay, 5000) || !int(l.perWeek, 20000)) throw new HttpError(422, `Frequency limits for ${cls} must be whole numbers (hour, day, week).`);
      if ((l.perHour as number) > (l.perDay as number) || (l.perDay as number) > (l.perWeek as number)) throw new HttpError(422, `Frequency limits for ${cls} must not shrink from hour to day to week.`);
    }
    if (c.maxAutomatedFollowups !== undefined && !int(c.maxAutomatedFollowups, 50)) throw new HttpError(422, "maxAutomatedFollowups must be a whole number.");
    // Marketing limits must never be able to starve security traffic: they are separate counters, and security may not be set below a floor.
    const sec = c.security as FrequencyLimit | undefined;
    if (sec && (sec.perHour < 3 || sec.perDay < 5)) throw new HttpError(422, "Security limits cannot be set so low that verification and alerts could be blocked.");
    return c;
  }
  if (kind === "QUIET_HOURS") {
    if (c.enabled !== undefined && typeof c.enabled !== "boolean") throw new HttpError(422, "enabled must be true or false.");
    for (const k of ["start", "end"]) if (c[k] !== undefined && (typeof c[k] !== "string" || !HHMM.test(c[k] as string))) throw new HttpError(422, `${k} must be HH:MM.`);
    if (c.timezone !== undefined && !validTimezone(c.timezone)) throw new HttpError(422, "Unknown timezone.");
    const okChannels = ["SMS", "WHATSAPP", "EMAIL", "IN_APP"];
    if (c.channels !== undefined && (!Array.isArray(c.channels) || c.channels.some((x) => !okChannels.includes(x as string)))) throw new HttpError(422, "Invalid channel list.");
    const okTypes = ["SECURITY", "VERIFICATION", "PAYMENT", "PRIVACY"];
    if (c.exceptionTypes !== undefined && (!Array.isArray(c.exceptionTypes) || c.exceptionTypes.some((x) => !okTypes.includes(x as string)))) throw new HttpError(422, "Invalid exception types.");
    return c;
  }
  if (kind === "JURISDICTION_DEFAULTS") {
    if (c.unresolvedTransactional !== undefined && !["ALLOW", "REVIEW", "BLOCK"].includes(c.unresolvedTransactional as string)) throw new HttpError(422, "Invalid unresolvedTransactional.");
    if (c.unresolvedMarketing !== undefined && !["REVIEW", "BLOCK"].includes(c.unresolvedMarketing as string)) throw new HttpError(422, "Marketing in an unresolved jurisdiction can only be REVIEW or BLOCK.");
    if (c.requireVerifiedContactFor !== undefined && (!Array.isArray(c.requireVerifiedContactFor) || c.requireVerifiedContactFor.some((x) => !["MARKETING", "SUPPORT", "PROPOSAL"].includes(x as string)))) throw new HttpError(422, "Invalid requireVerifiedContactFor.");
    return c;
  }
  if (kind === "ENVIRONMENT") {
    if (c.testRecipients !== undefined && (!Array.isArray(c.testRecipients) || c.testRecipients.length > 50 || c.testRecipients.some((x) => typeof x !== "string" || x.length > 120))) throw new HttpError(422, "testRecipients must be a short list of addresses.");
    return c;
  }
  throw new HttpError(404, "Unknown policy kind.");
}

export async function setPolicy(params: { kind: PolicyKindKey; config: unknown; actorId: string; reason: string; policyKey?: string; jurisdictionScope?: string }) {
  const config = validatePolicyConfig(params.kind, params.config);
  const policyKey = params.policyKey ?? "default";
  const scope = params.jurisdictionScope ?? "GLOBAL";
  const latest = await prisma.communicationPolicy.findFirst({ where: { kind: params.kind as CommunicationPolicyKind, policyKey, jurisdictionScope: scope }, orderBy: { version: "desc" } });
  const version = (latest?.version ?? 0) + 1;
  const [, created] = await prisma.$transaction([
    prisma.communicationPolicy.updateMany({ where: { kind: params.kind as CommunicationPolicyKind, policyKey, jurisdictionScope: scope, status: "ACTIVE" }, data: { status: "SUPERSEDED" } }),
    prisma.communicationPolicy.create({ data: { kind: params.kind as CommunicationPolicyKind, policyKey, version, configuration: JSON.stringify(config), status: "ACTIVE", jurisdictionScope: scope, createdById: params.actorId } }),
  ]);
  clearCommunicationPolicyCache();
  await writeAudit({ action: "COMMUNICATION_POLICY_CHANGED", adminId: params.actorId, meta: { kind: params.kind, policyKey, version, scope, reason: params.reason.slice(0, 300) } });
  return created;
}
