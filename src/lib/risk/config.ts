import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http-error";
import type { RiskSignalCategory, SecurityFlagSeverity, RiskConfidence } from "@prisma/client";

// STEP 24 — versioned risk configuration. Every threshold that used to be a
// hard-coded literal in signal-engine.ts now lives here as a DEFAULT; an active
// RiskRule row (versioned, never edited in place) overrides it. With an empty
// table the defaults reproduce the previous behaviour exactly, so this layer is
// additive and safe to deploy before any rule is ever configured.

export type RuleValue = number | boolean;
export type RuleConfig = Record<string, RuleValue>;

export interface RuleDefinition {
  name: string;
  category: RiskSignalCategory;
  description: string;
  defaults: RuleConfig;
  // Hard upper bound for numeric values — stops a tampered/typo'd rule from
  // effectively disabling detection (or producing absurd windows).
  max: number;
}

export const RULE_DEFINITIONS = {
  rapid_registration: { name: "Rapid registration sharing a contact", category: "ACCOUNT", description: "Profiles registered within the window that share a mobile number or e-mail.", defaults: { threshold: 3, windowMinutes: 60 }, max: 1440 },
  contact_reuse: { name: "Contact reuse across profiles", category: "CONTACT", description: "A mobile number or e-mail shared across distinct profiles.", defaults: { threshold: 2 }, max: 50 },
  excessive_proposals: { name: "Excessive proposal activity", category: "PROPOSAL_ACTIVITY", description: "Proposals involving one profile inside the window.", defaults: { threshold: 20, windowHours: 24 }, max: 720 },
  abnormal_contact_requests: { name: "Abnormal contact-request activity", category: "COMMUNICATION", description: "Contact-sharing requests from one profile inside the window.", defaults: { threshold: 10, windowHours: 24 }, max: 720 },
  payment_anomaly: { name: "Repeated payment failures", category: "PAYMENT", description: "Failed payment attempts inside the window. Payment status never affects matrimonial compatibility.", defaults: { threshold: 5, windowHours: 24 }, max: 720 },
  login_abuse: { name: "Repeated failed logins", category: "LOGIN_SECURITY", description: "Failed logins against one account inside the window.", defaults: { threshold: 8, windowMinutes: 15 }, max: 1440 },
  otp_abuse: { name: "Repeated OTP requests/failures", category: "LOGIN_SECURITY", description: "OTP requests or failures for one subject inside the window. A single mistyped code is never a signal.", defaults: { threshold: 10, windowMinutes: 60 }, max: 1440 },
  contact_bypass: { name: "Contact-workflow bypass attempts", category: "COMMUNICATION", description: "Repeated denied attempts to reach contact details that are not yet permitted.", defaults: { threshold: 3, windowHours: 24 }, max: 720 },
  permission_denied_burst: { name: "Burst of permission denials", category: "ADMIN_ACCESS", description: "Many permission/authorization denials for one account inside the window.", defaults: { threshold: 15, windowMinutes: 10 }, max: 1440 },
  privileged_access_volume: { name: "Unusual privileged-access volume", category: "ADMIN_ACCESS", description: "Distinct sensitive records accessed by one admin inside the window. Volume-based only — never an accusation.", defaults: { distinctTargets: 30, windowHours: 1 }, max: 720 },
  verification_failures: { name: "Repeated identity-verification rejections", category: "IDENTITY", description: "Verification attempts REJECTED or mismatched inside the window. A provider outage/timeout is never counted.", defaults: { threshold: 3, windowHours: 24 }, max: 720 },
  family_access_abuse: { name: "Unusual family-access activity", category: "FAMILY_ACCESS", description: "Family invitation/access requests inside the window.", defaults: { threshold: 10, windowHours: 24 }, max: 720 },
  profile_churn: { name: "Repeated profile/contact changes", category: "PROFILE_ACTIVITY", description: "Repeated identity-adjacent updates inside the window.", defaults: { threshold: 6, windowHours: 24 }, max: 720 },
  report_concentration: { name: "Multiple independent reports about one profile", category: "SAFETY", description: "Distinct reporters raising concerns about one profile. An allegation is not proof.", defaults: { distinctReporters: 3, windowDays: 30 }, max: 365 },
  // Device/network signals are OFF by default: they are privacy-sensitive, only
  // ever stored as salted hashes, and can never be the sole basis for action.
  shared_device: { name: "Shared device signal", category: "DEVICE", description: "Several profiles sharing one hashed device fingerprint. Shared family devices are common.", defaults: { enabled: false, minProfiles: 3, windowDays: 30 }, max: 365 },
  unusual_network: { name: "Unusual shared-network signal", category: "NETWORK", description: "Many profiles from one hashed network identifier. Shared homes/offices/VPNs are common.", defaults: { enabled: false, minProfiles: 6, windowDays: 7 }, max: 365 },
  score_bands: { name: "Risk score bands", category: "ACCOUNT", description: "Lower bound of each internal band (0-19 LOW, 20-39 MEDIUM, 40-69 HIGH, 70-100 CRITICAL).", defaults: { medium: 20, high: 40, critical: 70 }, max: 100 },
  case_policy: { name: "Automatic case opening", category: "ACCOUNT", description: "Assessment level at which a human-review case is opened automatically (2=MEDIUM 3=HIGH 4=CRITICAL). Cases only ever request review.", defaults: { autoOpenFromLevel: 3, reviewDueHours: 72 }, max: 720 },
  scoring: { name: "Scoring enabled", category: "ACCOUNT", description: "When false, only the level (no numeric score) is derived from signals.", defaults: { enabled: true }, max: 1 },
} satisfies Record<string, RuleDefinition>;

export type RuleKey = keyof typeof RULE_DEFINITIONS;

export function isRuleKey(key: string): key is RuleKey {
  return Object.prototype.hasOwnProperty.call(RULE_DEFINITIONS, key);
}

// Sensitive traits that must never become a factor, rule key, rule field or
// duplicate-evidence field (spec §"no sensitive traits in scoring").
const FORBIDDEN_TRAIT_PATTERN =
  /relig|sect\b|ethnic|caste|\brace\b|racial|family[_\s-]?background|income|salary|wealth|attractive|appearance|beauty|politic|health|disab|orientation|nationality|photo[_\s-]?similar|facial|face[_\s-]?match/i;

export function isForbiddenTraitField(name: string): boolean {
  return FORBIDDEN_TRAIT_PATTERN.test(name);
}

export function assertNoSensitiveTraits(fields: string[], context: string): void {
  const bad = fields.filter(isForbiddenTraitField);
  if (bad.length > 0) {
    throw new HttpError(422, `${context} may not use sensitive personal traits (${bad.join(", ")}).`);
  }
}

// ---------- factors ----------

export interface FactorDefinition {
  name: string;
  category: RiskSignalCategory;
  weight: number; // contribution to the internal 0-100 score
  severity: SecurityFlagSeverity;
  confidence: RiskConfidence; // default confidence of a signal produced for this factor
  immediateControl: boolean; // may raise the level from one low-confidence signal (e.g. an active credential-stuffing attack)
}

// Keyed by SecurityFlagType so an assessment can look up any signal's factor. Calibration: a single
// default-confidence MEDIUM-severity signal lands in the MEDIUM band (>=20), a single strong HIGH-severity
// signal in HIGH (>=40), while weak/allegation-type signals (payments, reports, churn, device, network)
// stay LOW on their own and only matter in combination.
export const FACTOR_DEFINITIONS: Record<string, FactorDefinition> = {
  RAPID_REGISTRATION_SIGNAL: { name: "Rapid registration", category: "ACCOUNT", weight: 34, severity: "MEDIUM", confidence: "MEDIUM", immediateControl: false },
  CONTACT_REUSE_SIGNAL: { name: "Contact reuse", category: "CONTACT", weight: 26, severity: "MEDIUM", confidence: "HIGH", immediateControl: false },
  EXCESSIVE_PROPOSAL_ACTIVITY: { name: "Excessive proposal activity", category: "PROPOSAL_ACTIVITY", weight: 10, severity: "LOW", confidence: "MEDIUM", immediateControl: false },
  ABNORMAL_CONTACT_REQUEST_ACTIVITY: { name: "Abnormal contact-request activity", category: "COMMUNICATION", weight: 34, severity: "MEDIUM", confidence: "MEDIUM", immediateControl: false },
  PAYMENT_ANOMALY_SIGNAL: { name: "Payment failures", category: "PAYMENT", weight: 8, severity: "MEDIUM", confidence: "LOW", immediateControl: false },
  REPEATED_PAYMENT_FAILURE: { name: "Payment failures", category: "PAYMENT", weight: 8, severity: "MEDIUM", confidence: "LOW", immediateControl: false },
  DUPLICATE_PROFILE_SUSPECTED: { name: "Possible duplicate account", category: "DUPLICATE", weight: 50, severity: "HIGH", confidence: "HIGH", immediateControl: false },
  LOGIN_ABUSE_SIGNAL: { name: "Repeated failed logins", category: "LOGIN_SECURITY", weight: 34, severity: "MEDIUM", confidence: "MEDIUM", immediateControl: true },
  OTP_ABUSE_SIGNAL: { name: "Repeated OTP activity", category: "LOGIN_SECURITY", weight: 34, severity: "MEDIUM", confidence: "MEDIUM", immediateControl: true },
  REPEATED_FAILED_OTP: { name: "Repeated OTP failures", category: "LOGIN_SECURITY", weight: 34, severity: "MEDIUM", confidence: "MEDIUM", immediateControl: false },
  CONTACT_BYPASS_ATTEMPT: { name: "Contact-workflow bypass attempts", category: "COMMUNICATION", weight: 44, severity: "HIGH", confidence: "HIGH", immediateControl: false },
  UNAUTHORIZED_ACCESS_ATTEMPT: { name: "Repeated permission denials", category: "ADMIN_ACCESS", weight: 34, severity: "HIGH", confidence: "MEDIUM", immediateControl: false },
  UNUSUAL_PRIVILEGED_ACCESS: { name: "Unusual privileged-access volume", category: "ADMIN_ACCESS", weight: 40, severity: "HIGH", confidence: "MEDIUM", immediateControl: false },
  FAMILY_ACCESS_ABUSE_SIGNAL: { name: "Unusual family-access activity", category: "FAMILY_ACCESS", weight: 14, severity: "MEDIUM", confidence: "LOW", immediateControl: false },
  SHARED_DEVICE_SIGNAL: { name: "Shared device", category: "DEVICE", weight: 6, severity: "LOW", confidence: "LOW", immediateControl: false },
  UNUSUAL_NETWORK_ACTIVITY: { name: "Unusual shared network", category: "NETWORK", weight: 4, severity: "LOW", confidence: "LOW", immediateControl: false },
  PROFILE_CHURN_SIGNAL: { name: "Repeated profile changes", category: "PROFILE_ACTIVITY", weight: 10, severity: "LOW", confidence: "LOW", immediateControl: false },
  IDENTITY_VERIFICATION_REVIEW: { name: "Identity verification needs review", category: "IDENTITY", weight: 34, severity: "MEDIUM", confidence: "MEDIUM", immediateControl: false },
  VERIFICATION_INCONSISTENCY: { name: "Verification inconsistency", category: "IDENTITY", weight: 34, severity: "MEDIUM", confidence: "MEDIUM", immediateControl: false },
  SAFETY_REPORT_SIGNAL: { name: "Safety report", category: "SAFETY", weight: 20, severity: "MEDIUM", confidence: "LOW", immediateControl: false },
  ABUSIVE_BEHAVIOR_REPORT: { name: "Behaviour report", category: "ABUSE", weight: 34, severity: "MEDIUM", confidence: "LOW", immediateControl: false },
};

const DEFAULT_FACTOR: FactorDefinition = { name: "Other signal", category: "ACCOUNT", weight: 10, severity: "LOW", confidence: "LOW", immediateControl: false };

export function defaultFactorFor(flagType: string): FactorDefinition {
  return FACTOR_DEFINITIONS[flagType] ?? DEFAULT_FACTOR;
}

// ---------- effective rule lookup (in-process cache, 30s) ----------

interface EffectiveRule {
  ruleKey: string;
  version: number; // 0 = built-in default
  config: RuleConfig;
}

const CACHE_TTL_MS = 30_000;
const ruleCache = new Map<string, { at: number; value: EffectiveRule }>();
const factorCache = new Map<string, { at: number; value: EffectiveFactor }>();

export function clearRiskConfigCache(): void {
  ruleCache.clear();
  factorCache.clear();
}

function parseConfig(raw: string, defaults: RuleConfig): RuleConfig {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const merged: RuleConfig = { ...defaults };
    for (const [key, value] of Object.entries(parsed)) {
      if (key in defaults && typeof value === typeof defaults[key]) merged[key] = value as RuleValue;
    }
    return merged;
  } catch {
    return { ...defaults };
  }
}

export async function getEffectiveRule(ruleKey: RuleKey, jurisdictionScope = "GLOBAL"): Promise<EffectiveRule> {
  const cacheKey = `${ruleKey}:${jurisdictionScope}`;
  const hit = ruleCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const def = RULE_DEFINITIONS[ruleKey];
  let value: EffectiveRule = { ruleKey, version: 0, config: { ...def.defaults } };
  try {
    const now = new Date();
    const scopes = jurisdictionScope === "GLOBAL" ? ["GLOBAL"] : [jurisdictionScope, "GLOBAL"];
    const rows = await prisma.riskRule.findMany({
      where: { ruleKey, status: "ACTIVE", jurisdictionScope: { in: scopes }, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
      orderBy: { version: "desc" },
    });
    // A jurisdiction-specific rule outranks the GLOBAL one.
    const row = rows.find((r) => r.jurisdictionScope === jurisdictionScope) ?? rows[0];
    if (row) value = { ruleKey, version: row.version, config: parseConfig(row.configuration, def.defaults) };
  } catch {
    // Config must never break detection: fall back to the built-in defaults.
  }
  ruleCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

export interface EffectiveFactor extends FactorDefinition {
  factorKey: string;
  version: number;
  enabled: boolean;
}

export async function getEffectiveFactor(flagType: string, jurisdictionScope = "GLOBAL"): Promise<EffectiveFactor> {
  const cacheKey = `${flagType}:${jurisdictionScope}`;
  const hit = factorCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const def = defaultFactorFor(flagType);
  let value: EffectiveFactor = { ...def, factorKey: flagType, version: 0, enabled: true };
  try {
    const now = new Date();
    const scopes = jurisdictionScope === "GLOBAL" ? ["GLOBAL"] : [jurisdictionScope, "GLOBAL"];
    const rows = await prisma.riskFactor.findMany({
      where: { factorKey: flagType, status: "ACTIVE", jurisdictionScope: { in: scopes }, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
      orderBy: { version: "desc" },
    });
    const row = rows.find((r) => r.jurisdictionScope === jurisdictionScope) ?? rows[0];
    if (row) {
      value = { name: row.name, category: row.category, weight: row.weight, severity: row.severity, confidence: def.confidence, immediateControl: row.immediateControl, factorKey: flagType, version: row.version, enabled: row.enabled };
    }
  } catch {
    // fall back to defaults
  }
  factorCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

// ---------- validated writes (new version, never in place) ----------

export function validateRuleConfig(ruleKey: string, config: Record<string, unknown>): RuleConfig {
  if (!isRuleKey(ruleKey)) throw new HttpError(404, "Unknown risk rule.");
  const def = RULE_DEFINITIONS[ruleKey] as RuleDefinition;
  assertNoSensitiveTraits(Object.keys(config), "A risk rule");
  const out: RuleConfig = { ...def.defaults };
  for (const [key, value] of Object.entries(config)) {
    if (!(key in def.defaults)) throw new HttpError(422, `Unknown field "${key}" for rule ${ruleKey}.`);
    const expected = typeof def.defaults[key];
    if (typeof value !== expected) throw new HttpError(422, `Field "${key}" must be a ${expected}.`);
    if (typeof value === "number") {
      if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0 || value > def.max) throw new HttpError(422, `Field "${key}" must be a whole number between 0 and ${def.max}.`);
    }
    out[key] = value as RuleValue;
  }
  if (ruleKey === "score_bands") {
    const { medium, high, critical } = out as { medium: number; high: number; critical: number };
    if (!(medium > 0 && medium < high && high < critical && critical <= 100)) throw new HttpError(422, "Score bands must satisfy 0 < medium < high < critical <= 100.");
  }
  return out;
}

export async function setRule(params: { ruleKey: string; config: Record<string, unknown>; actorId: string; jurisdictionScope?: string; reason: string }) {
  const config = validateRuleConfig(params.ruleKey, params.config);
  const scope = params.jurisdictionScope ?? "GLOBAL";
  const def = RULE_DEFINITIONS[params.ruleKey as RuleKey] as RuleDefinition;

  const latest = await prisma.riskRule.findFirst({ where: { ruleKey: params.ruleKey, jurisdictionScope: scope }, orderBy: { version: "desc" } });
  const version = (latest?.version ?? 0) + 1;
  const now = new Date();
  const [, created] = await prisma.$transaction([
    prisma.riskRule.updateMany({ where: { ruleKey: params.ruleKey, jurisdictionScope: scope, status: "ACTIVE" }, data: { status: "SUPERSEDED", effectiveTo: now } }),
    prisma.riskRule.create({
      data: { ruleKey: params.ruleKey, version, name: def.name, category: def.category, description: def.description, configuration: JSON.stringify(config), status: "ACTIVE", jurisdictionScope: scope, effectiveFrom: now, createdById: params.actorId },
    }),
  ]);
  clearRiskConfigCache();
  await writeAudit({
    action: "RISK_RULE_CHANGED",
    adminId: params.actorId,
    meta: { ruleKey: params.ruleKey, version, jurisdictionScope: scope, reason: params.reason, previousVersion: latest?.version ?? 0 },
  });
  return created;
}

export async function setFactor(params: { factorKey: string; weight: number; enabled: boolean; severity?: SecurityFlagSeverity; actorId: string; jurisdictionScope?: string; reason: string }) {
  assertNoSensitiveTraits([params.factorKey], "A risk factor");
  if (!Object.prototype.hasOwnProperty.call(FACTOR_DEFINITIONS, params.factorKey)) throw new HttpError(404, "Unknown risk factor.");
  if (!Number.isInteger(params.weight) || params.weight < 0 || params.weight > 60) throw new HttpError(422, "Factor weight must be a whole number between 0 and 60.");
  const scope = params.jurisdictionScope ?? "GLOBAL";
  const def = FACTOR_DEFINITIONS[params.factorKey];

  const latest = await prisma.riskFactor.findFirst({ where: { factorKey: params.factorKey, jurisdictionScope: scope }, orderBy: { version: "desc" } });
  const version = (latest?.version ?? 0) + 1;
  const now = new Date();
  const [, created] = await prisma.$transaction([
    prisma.riskFactor.updateMany({ where: { factorKey: params.factorKey, jurisdictionScope: scope, status: "ACTIVE" }, data: { status: "SUPERSEDED", effectiveTo: now } }),
    prisma.riskFactor.create({
      data: {
        factorKey: params.factorKey,
        version,
        name: def.name,
        category: def.category,
        weight: params.weight,
        severity: params.severity ?? def.severity,
        enabled: params.enabled,
        immediateControl: def.immediateControl, // not editable: only code may grant a factor immediate-control status
        status: "ACTIVE",
        jurisdictionScope: scope,
        effectiveFrom: now,
        createdById: params.actorId,
      },
    }),
  ]);
  clearRiskConfigCache();
  await writeAudit({ action: "RISK_RULE_CHANGED", adminId: params.actorId, meta: { factorKey: params.factorKey, version, weight: params.weight, enabled: params.enabled, reason: params.reason } });
  return created;
}

// Snapshot of what is currently in force — recorded on every assessment so it
// stays reproducible/explainable after later configuration changes.
export async function getConfigurationVersion(): Promise<number> {
  try {
    const agg = await prisma.riskRule.aggregate({ where: { status: "ACTIVE" }, _max: { version: true } });
    return agg._max.version ?? 0;
  } catch {
    return 0;
  }
}
