import { prisma } from "@/lib/prisma";
import { getRetentionPolicy as getPlatformRetentionPolicy } from "@/lib/privacy/retention-policy";
import type { DataCategory } from "@prisma/client";

// The Legal Compliance Rule Engine (spec §5) — every method below only ever
// reads ACTIVE rules (status=ACTIVE, effectiveFrom<=now, effectiveTo in
// range — spec §6: "only ACTIVE rules may affect production behavior") and
// NEVER invents a default. Absent a matching rule, every method returns
// `resolved: false, reviewRequired: true` — never a guessed value.

export interface RuleMatch {
  id: string;
  ruleCode: string;
  subject: string;
}

export interface RuleEvaluation<T = unknown> {
  resolved: boolean;
  value: T | null;
  reviewRequired: boolean;
  matchedRules: RuleMatch[];
}

async function findActiveRules(jurisdictionId: string, requirementType: string, subject?: string) {
  const now = new Date();
  return prisma.complianceRule.findMany({
    where: {
      jurisdictionId,
      requirementType,
      status: "ACTIVE",
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      ...(subject ? { subject } : {}),
    },
    orderBy: { ruleVersion: "desc" },
  });
}

export async function getApplicableRules(jurisdictionId: string, requirementType?: string) {
  const now = new Date();
  return prisma.complianceRule.findMany({
    where: {
      jurisdictionId,
      status: "ACTIVE",
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      ...(requirementType ? { requirementType } : {}),
    },
  });
}

export async function evaluateRequirement<T = unknown>(jurisdictionId: string, requirementType: string, subject?: string): Promise<RuleEvaluation<T>> {
  const rules = await findActiveRules(jurisdictionId, requirementType, subject);
  if (rules.length === 0) return { resolved: false, value: null, reviewRequired: true, matchedRules: [] };

  const rule = rules[0]; // latest ruleVersion wins
  let value: T | null = null;
  try {
    value = JSON.parse(rule.configuration) as T;
  } catch {
    return { resolved: false, value: null, reviewRequired: true, matchedRules: [] };
  }
  return { resolved: true, value, reviewRequired: false, matchedRules: rules.map((r) => ({ id: r.id, ruleCode: r.ruleCode, subject: r.subject })) };
}

export function requiresConsent(jurisdictionId: string, purpose: string) {
  return evaluateRequirement<{ required: boolean; legalBasisOptions?: string[] }>(jurisdictionId, "CONSENT_REQUIRED", purpose);
}

export function requiresVerification(jurisdictionId: string, verificationType: string) {
  return evaluateRequirement<{ required: boolean; allowedDocumentTypes?: string[] }>(jurisdictionId, "VERIFICATION_REQUIRED", verificationType);
}

export function requiresHumanReview(jurisdictionId: string, action: string) {
  return evaluateRequirement<{ required: boolean }>(jurisdictionId, "HUMAN_REVIEW_REQUIRED", action);
}

// Delegated to by src/lib/compliance/transfer.ts's assessTransfer() rather
// than duplicated there — this is the single place a CROSS_BORDER_TRANSFER
// rule is looked up. subject is the "SOURCE:DEST" jurisdiction-code pair.
export function isCrossBorderTransferAllowed(sourceJurisdictionId: string, destJurisdictionCode: string) {
  return evaluateRequirement<{ status: "ALLOWED" | "ALLOWED_WITH_CONTROLS" | "BLOCKED"; controls?: string[] }>(
    sourceJurisdictionId,
    "CROSS_BORDER_TRANSFER",
    destJurisdictionCode
  );
}

// The one place the new engine explicitly defers to the existing STEP 13
// system (plan decision 4) — a jurisdiction-specific rule can override the
// platform-wide RetentionPolicy-by-DataCategory, but absent one, the
// existing table is the answer, not REVIEW_REQUIRED (STEP 13's retention
// system already works and is not being second-guessed by this add-on).
export async function getRetentionPolicy(jurisdictionId: string, dataCategory: DataCategory) {
  const ruleResult = await evaluateRequirement<{ retentionDays: number; action: string }>(jurisdictionId, "RETENTION_PERIOD", dataCategory);
  if (ruleResult.resolved) return ruleResult;

  const platformPolicy = await getPlatformRetentionPolicy(dataCategory);
  if (!platformPolicy) return { resolved: false, value: null, reviewRequired: true, matchedRules: [] };
  return {
    resolved: true,
    value: { retentionDays: platformPolicy.retentionDays, action: platformPolicy.action },
    reviewRequired: false,
    matchedRules: [],
  };
}

export function getDeletionRequirements(jurisdictionId: string, dataCategory: DataCategory) {
  return evaluateRequirement<{ mode: "DELETE" | "ANONYMIZE"; notes?: string }>(jurisdictionId, "DELETION_REQUIREMENT", dataCategory);
}

export function getDisclosureRequirements(jurisdictionId: string, purpose: string) {
  return evaluateRequirement<{ requiresNotice: boolean; noticeText?: string }>(jurisdictionId, "DISCLOSURE_REQUIREMENT", purpose);
}

export function requiresAgeRestriction(jurisdictionId: string) {
  return evaluateRequirement<{ minAge: number }>(jurisdictionId, "AGE_MINIMUM");
}

export function requiresSpecialHandling(jurisdictionId: string, dataType: string) {
  return evaluateRequirement<{ required: boolean; handling?: string }>(jurisdictionId, "SPECIAL_HANDLING", dataType);
}

// STEP 23 Add-on — used by src/lib/family/access-control.ts's
// getFamilyMembership (the single choke point every family-visibility getter
// calls first). Absent a matching ACTIVE rule this resolves to `false`
// (never restricted) so the existing STEP 22 family portal keeps working
// unchanged for every jurisdiction that has no explicit, admin-approved
// restriction on file — restrictions are only ever opt-in, never inferred.
export function isFamilyAccessRestricted(jurisdictionId: string) {
  return evaluateRequirement<{ restricted: boolean; reason?: string }>(jurisdictionId, "FAMILY_ACCESS_RESTRICTED");
}
