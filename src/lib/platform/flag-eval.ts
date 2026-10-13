import { createHash } from "crypto";
import { AdminRole, type FeatureFlagState } from "@prisma/client";
import { currentEnvironment, type PlatformEnvironment } from "@/lib/platform/environment-core";

// Feature flag states and controlled rollout (STEP 36 §7–§9). Pure, so every rule is tested.
//
//   ENABLED             on for everyone.
//   DISABLED            off for everyone.
//   PAUSED              off for everyone; a rollout that is on hold (the rule is kept).
//   EMERGENCY_DISABLED  off for everyone; set by an emergency kill switch.
//   ROLLOUT             on only for the subjects the rollout rule selects. For a caller that names no subject (the global question "is it on?") the answer is OFF.
//
// Targets can select by: a percentage of subjects (stable hash, so a person stays in or out), a role, a specific person, a country, the environment,
// or "internal" / "admin only" (administrators). Targeting NEVER uses a profile's personal attributes (religion, sect, health, income, family, caste, looks,
// age and so on), and a rollout rule cannot be built from them.

export const FLAG_STATES = ["DISABLED", "ENABLED", "ROLLOUT", "PAUSED", "EMERGENCY_DISABLED"] as const satisfies readonly FeatureFlagState[];

export const TARGET_TYPES = ["INTERNAL", "ADMIN_ONLY", "SPECIFIC_ROLE", "SPECIFIC_USER", "COUNTRY", "ENVIRONMENT"] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

export interface FlagTarget {
  type: TargetType;
  values?: string[];
}

export interface FlagRule {
  state: FeatureFlagState;
  rolloutPercent: number | null;
  targets: FlagTarget[];
}

/** Who is asking. Every field is optional: a caller gives only what it knows. */
export interface FlagSubject {
  /** A stable id (admin id or profile id) used for percentage rollout and for SPECIFIC_USER. */
  id?: string;
  isAdmin?: boolean;
  role?: string;
  country?: string;
  environment?: PlatformEnvironment;
}

export type RuleResult = { ok: true; rule: FlagRule } | { ok: false; error: string };

const ID = /^[A-Za-z0-9_-]{3,40}$/;
const COUNTRY = /^[\p{L} .'-]{2,60}$/u;

export function validateFlagRule(input: { state: unknown; rolloutPercent?: unknown; targets?: unknown }): RuleResult {
  const bad = (error: string): RuleResult => ({ ok: false, error });
  if (typeof input.state !== "string" || !(FLAG_STATES as readonly string[]).includes(input.state)) return bad(`State must be one of ${FLAG_STATES.join(", ")}.`);
  const state = input.state as FeatureFlagState;

  let percent: number | null = null;
  if (input.rolloutPercent !== undefined && input.rolloutPercent !== null) {
    if (typeof input.rolloutPercent !== "number" || !Number.isInteger(input.rolloutPercent) || input.rolloutPercent < 0 || input.rolloutPercent > 100) return bad("Rollout percentage must be a whole number from 0 to 100.");
    percent = input.rolloutPercent;
  }

  const targets: FlagTarget[] = [];
  if (input.targets !== undefined && input.targets !== null) {
    if (!Array.isArray(input.targets) || input.targets.length > 10) return bad("Targets must be a list of at most 10.");
    for (const t of input.targets) {
      if (typeof t !== "object" || t === null) return bad("Each target must be an object.");
      const type = (t as { type?: unknown }).type;
      if (typeof type !== "string" || !(TARGET_TYPES as readonly string[]).includes(type)) return bad(`Target type must be one of ${TARGET_TYPES.join(", ")}.`);
      const rawValues = (t as { values?: unknown }).values;
      const values = rawValues === undefined ? [] : rawValues;
      if (!Array.isArray(values) || values.length > 50 || values.some((v) => typeof v !== "string")) return bad("Target values must be a list of at most 50 text values.");
      const list = (values as string[]).map((v) => v.trim());
      if (type === "SPECIFIC_ROLE" && list.some((v) => !(Object.values(AdminRole) as string[]).includes(v))) return bad("A role target must name an administrator role.");
      if (type === "SPECIFIC_USER" && list.some((v) => !ID.test(v))) return bad("A user target must be a user id.");
      if (type === "COUNTRY" && list.some((v) => !COUNTRY.test(v))) return bad("A country target must be a country name.");
      if (type === "ENVIRONMENT" && list.some((v) => !["DEVELOPMENT", "STAGING", "PRODUCTION"].includes(v.toUpperCase()))) return bad("An environment target must be DEVELOPMENT, STAGING or PRODUCTION.");
      if (["SPECIFIC_ROLE", "SPECIFIC_USER", "COUNTRY", "ENVIRONMENT"].includes(type) && list.length === 0) return bad(`A ${type.toLowerCase().replace("_", " ")} target needs at least one value.`);
      targets.push({ type: type as TargetType, values: list.map((v) => (type === "ENVIRONMENT" ? v.toUpperCase() : v)) });
    }
  }

  if (state === "ROLLOUT" && percent === null && targets.length === 0) return bad("A rollout needs a percentage or at least one target.");
  if (state !== "ROLLOUT" && state !== "PAUSED" && (percent !== null || targets.length > 0)) {
    // ENABLED / DISABLED / EMERGENCY_DISABLED carry no rule: refuse instead of silently storing something that would not apply.
    return bad("A rollout percentage or targets only apply to the ROLLOUT and PAUSED states.");
  }
  return { ok: true, rule: { state, rolloutPercent: percent, targets } };
}

/** 0–99, the same for the same flag and subject every time (so a person does not flip in and out of a rollout). */
export function rolloutBucket(flagKey: string, subjectId: string): number {
  const digest = createHash("sha256").update(`${flagKey}:${subjectId}`).digest();
  return digest.readUInt32BE(0) % 100;
}

function targetMatches(target: FlagTarget, subject: FlagSubject, env: PlatformEnvironment): boolean {
  const values = target.values ?? [];
  switch (target.type) {
    case "INTERNAL":
    case "ADMIN_ONLY":
      return subject.isAdmin === true;
    case "SPECIFIC_ROLE":
      return !!subject.role && values.includes(subject.role);
    case "SPECIFIC_USER":
      return !!subject.id && values.includes(subject.id);
    case "COUNTRY":
      return !!subject.country && values.some((v) => v.toLowerCase() === subject.country!.toLowerCase());
    case "ENVIRONMENT":
      return values.includes(subject.environment ?? env);
  }
}

export function evaluateFlag(flagKey: string, rule: FlagRule, subject: FlagSubject | undefined, env: PlatformEnvironment = currentEnvironment()): boolean {
  switch (rule.state) {
    case "ENABLED":
      return true;
    case "DISABLED":
    case "PAUSED":
    case "EMERGENCY_DISABLED":
      return false;
    case "ROLLOUT": {
      if (!subject) return false;
      // Any matching target turns it on; the percentage is one more way in, not a gate on top of the targets.
      if (rule.targets.some((t) => targetMatches(t, subject, env))) return true;
      if (rule.rolloutPercent !== null && subject.id) return rolloutBucket(flagKey, subject.id) < rule.rolloutPercent;
      return false;
    }
  }
}

/** The legacy boolean stored next to the state: true only when the flag is on for everyone. */
export function enabledForEveryone(state: FeatureFlagState): boolean {
  return state === "ENABLED";
}

/** Turning a flag ON (for everyone or for a rollout) from an off state, as opposed to switching it off or adjusting a rollout that is already running. */
export function isActivation(previous: FeatureFlagState, next: FeatureFlagState): boolean {
  const on = (s: FeatureFlagState) => s === "ENABLED" || s === "ROLLOUT";
  return on(next) && !on(previous);
}
