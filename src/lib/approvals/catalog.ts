import { prisma } from "@/lib/prisma";
import type { AssignmentResourceType, ApprovalRiskLevel, ApprovalLevel, AdminRole } from "@prisma/client";

// STEP 19 §6 — the centralized high-risk action catalog. actionType is a
// plain string key (not a Prisma enum) so Super Admin governance
// configuration (spec §9) can enable/disable and retune any entry at
// runtime without a schema migration — mirrors src/lib/workflow/automation-rules.ts's
// WorkflowRule.eventName being a String @unique for the identical reason.
// This module is metadata only: it seeds ApprovalPolicy defaults and gives
// the UI a human label/domain grouping. src/lib/approvals/policy-engine.ts's
// getApprovalPolicy() always reads the live ApprovalPolicy row (which an
// admin may have edited), never this static map, once seeded.

export type ApprovalDomain = "PROFILE" | "CONTACT" | "MATCHING" | "PROPOSAL" | "VERIFICATION" | "SAFETY" | "PRIVACY" | "FINANCE" | "ADMINISTRATION" | "AI";

export interface CatalogEntry {
  label: string;
  domain: ApprovalDomain;
  sourceType: AssignmentResourceType;
  defaultRiskLevel: ApprovalRiskLevel;
  defaultRequiredLevel: ApprovalLevel;
  defaultAllowedRoles: AdminRole[];
}

// Default required level follows spec §7's examples: LOW/routine -> LEVEL_1,
// sensitive workflow change -> LEVEL_2, contact/verification/refund/
// restriction -> LEVEL_2/3, deletion/large-refund/role-escalation/security
// override/payment-provider-change/mass operations -> LEVEL_3/4. All of
// these are admin-editable afterward via ApprovalPolicy — this is only the
// seed default.
export const APPROVAL_CATALOG: Record<string, CatalogEntry> = {
  // ---------- PROFILE ----------
  PROFILE_VERIFY: { label: "Verify profile", domain: "PROFILE", sourceType: "VERIFICATION", defaultRiskLevel: "MEDIUM", defaultRequiredLevel: "LEVEL_1", defaultAllowedRoles: ["VERIFICATION_MANAGER", "SUPER_ADMIN"] },
  PROFILE_REVERIFY: { label: "Require re-verification", domain: "PROFILE", sourceType: "VERIFICATION", defaultRiskLevel: "MEDIUM", defaultRequiredLevel: "LEVEL_1", defaultAllowedRoles: ["VERIFICATION_MANAGER", "SUPER_ADMIN"] },
  PROFILE_RESTRICT: { label: "Restrict profile", domain: "PROFILE", sourceType: "PROFILE", defaultRiskLevel: "HIGH", defaultRequiredLevel: "LEVEL_2", defaultAllowedRoles: ["SUPPORT_MANAGER", "SUPER_ADMIN"] },
  PROFILE_SUSPEND: { label: "Suspend profile", domain: "PROFILE", sourceType: "PROFILE", defaultRiskLevel: "HIGH", defaultRequiredLevel: "LEVEL_2", defaultAllowedRoles: ["SUPPORT_MANAGER", "SUPER_ADMIN"] },
  PROFILE_RESTORE: { label: "Restore profile", domain: "PROFILE", sourceType: "PROFILE", defaultRiskLevel: "MEDIUM", defaultRequiredLevel: "LEVEL_1", defaultAllowedRoles: ["SUPPORT_MANAGER", "OPERATIONS_ADMIN", "SUPER_ADMIN"] },
  PROFILE_ARCHIVE: { label: "Archive profile", domain: "PROFILE", sourceType: "PROFILE", defaultRiskLevel: "MEDIUM", defaultRequiredLevel: "LEVEL_1", defaultAllowedRoles: ["OPERATIONS_ADMIN", "SUPER_ADMIN"] },
  PROFILE_DELETE: { label: "Delete profile", domain: "PROFILE", sourceType: "PROFILE", defaultRiskLevel: "CRITICAL", defaultRequiredLevel: "LEVEL_4", defaultAllowedRoles: ["SUPER_ADMIN"] },
  SENSITIVE_PROFILE_CHANGE: { label: "Sensitive profile field change", domain: "PROFILE", sourceType: "PROFILE", defaultRiskLevel: "MEDIUM", defaultRequiredLevel: "LEVEL_1", defaultAllowedRoles: ["OPERATIONS_ADMIN", "SUPER_ADMIN"] },

  // ---------- CONTACT ----------
  CONTACT_ACCESS_REQUEST: { label: "Request contact access", domain: "CONTACT", sourceType: "PROPOSAL", defaultRiskLevel: "HIGH", defaultRequiredLevel: "LEVEL_2", defaultAllowedRoles: ["MATCHMAKING_MANAGER", "SUPER_ADMIN"] },
  CONTACT_SHARE: { label: "Share contact information", domain: "CONTACT", sourceType: "PROPOSAL", defaultRiskLevel: "HIGH", defaultRequiredLevel: "LEVEL_2", defaultAllowedRoles: ["MATCHMAKING_MANAGER", "SUPER_ADMIN"] },
  CONTACT_SHARE_OVERRIDE: { label: "Override contact-sharing consent gate", domain: "CONTACT", sourceType: "PROPOSAL", defaultRiskLevel: "CRITICAL", defaultRequiredLevel: "LEVEL_4", defaultAllowedRoles: ["SUPER_ADMIN"] },
  FAMILY_CONTACT_SHARE: { label: "Share family contact information", domain: "CONTACT", sourceType: "PROPOSAL", defaultRiskLevel: "HIGH", defaultRequiredLevel: "LEVEL_2", defaultAllowedRoles: ["MATCHMAKING_MANAGER", "SUPER_ADMIN"] },

  // ---------- MATCHING ----------
  MATCH_OVERRIDE: { label: "Override a match decision", domain: "MATCHING", sourceType: "PROFILE", defaultRiskLevel: "MEDIUM", defaultRequiredLevel: "LEVEL_2", defaultAllowedRoles: ["MATCHMAKING_MANAGER", "SUPER_ADMIN"] },
  MATCH_SCORE_OVERRIDE: { label: "Override a match score", domain: "MATCHING", sourceType: "PROFILE", defaultRiskLevel: "MEDIUM", defaultRequiredLevel: "LEVEL_2", defaultAllowedRoles: ["MATCHMAKING_MANAGER", "SUPER_ADMIN"] },
  MATCH_RECOMMENDATION_OVERRIDE: { label: "Override a match recommendation", domain: "MATCHING", sourceType: "PROFILE", defaultRiskLevel: "MEDIUM", defaultRequiredLevel: "LEVEL_1", defaultAllowedRoles: ["MATCHMAKING_MANAGER", "SUPER_ADMIN"] },
  MATCH_RECALCULATION_OVERRIDE: { label: "Force match recalculation override", domain: "MATCHING", sourceType: "PROFILE", defaultRiskLevel: "MEDIUM", defaultRequiredLevel: "LEVEL_1", defaultAllowedRoles: ["MATCHMAKING_MANAGER", "SUPER_ADMIN"] },

  // ---------- PROPOSALS ----------
  PROPOSAL_CREATE_HIGH_RISK: { label: "Create a high-risk proposal", domain: "PROPOSAL", sourceType: "PROPOSAL", defaultRiskLevel: "MEDIUM", defaultRequiredLevel: "LEVEL_1", defaultAllowedRoles: ["MATCHMAKING_MANAGER", "SUPER_ADMIN"] },
  PROPOSAL_OVERRIDE: { label: "Override a proposal decision", domain: "PROPOSAL", sourceType: "PROPOSAL", defaultRiskLevel: "HIGH", defaultRequiredLevel: "LEVEL_2", defaultAllowedRoles: ["MATCHMAKING_MANAGER", "SUPER_ADMIN"] },
  PROPOSAL_CLOSE_OVERRIDE: { label: "Override proposal closure", domain: "PROPOSAL", sourceType: "PROPOSAL", defaultRiskLevel: "HIGH", defaultRequiredLevel: "LEVEL_2", defaultAllowedRoles: ["MATCHMAKING_MANAGER", "SUPER_ADMIN"] },
  PROPOSAL_FINALIZE: { label: "Finalize a proposal", domain: "PROPOSAL", sourceType: "PROPOSAL", defaultRiskLevel: "HIGH", defaultRequiredLevel: "LEVEL_2", defaultAllowedRoles: ["MATCHMAKING_MANAGER", "SUPER_ADMIN"] },
  PROPOSAL_MARK_MARRIED: { label: "Mark a proposal as married", domain: "PROPOSAL", sourceType: "PROPOSAL", defaultRiskLevel: "HIGH", defaultRequiredLevel: "LEVEL_2", defaultAllowedRoles: ["MATCHMAKING_MANAGER", "SUPER_ADMIN"] },

  // ---------- VERIFICATION ----------
  VERIFICATION_APPROVE: { label: "Approve verification", domain: "VERIFICATION", sourceType: "VERIFICATION", defaultRiskLevel: "HIGH", defaultRequiredLevel: "LEVEL_1", defaultAllowedRoles: ["VERIFICATION_MANAGER", "SUPER_ADMIN"] },
  VERIFICATION_REJECT_OVERRIDE: { label: "Override a verification rejection", domain: "VERIFICATION", sourceType: "VERIFICATION", defaultRiskLevel: "HIGH", defaultRequiredLevel: "LEVEL_2", defaultAllowedRoles: ["VERIFICATION_MANAGER", "SUPER_ADMIN"] },
  VERIFICATION_OVERRIDE: { label: "Override a verification decision", domain: "VERIFICATION", sourceType: "VERIFICATION", defaultRiskLevel: "HIGH", defaultRequiredLevel: "LEVEL_2", defaultAllowedRoles: ["VERIFICATION_MANAGER", "SUPER_ADMIN"] },
  DOCUMENT_APPROVAL_OVERRIDE: { label: "Override a document approval decision", domain: "VERIFICATION", sourceType: "VERIFICATION", defaultRiskLevel: "MEDIUM", defaultRequiredLevel: "LEVEL_1", defaultAllowedRoles: ["VERIFICATION_MANAGER", "SUPER_ADMIN"] },

  // ---------- SAFETY ----------
  SAFETY_RESTRICTION: { label: "Apply a safety restriction", domain: "SAFETY", sourceType: "PROFILE", defaultRiskLevel: "HIGH", defaultRequiredLevel: "LEVEL_2", defaultAllowedRoles: ["SUPPORT_MANAGER", "SUPER_ADMIN"] },
  PROFILE_SUSPENSION: { label: "Suspend profile (safety)", domain: "SAFETY", sourceType: "PROFILE", defaultRiskLevel: "HIGH", defaultRequiredLevel: "LEVEL_2", defaultAllowedRoles: ["SUPPORT_MANAGER", "SUPER_ADMIN"] },
  SAFETY_CASE_ESCALATION: { label: "Escalate a safety case", domain: "SAFETY", sourceType: "CASE", defaultRiskLevel: "HIGH", defaultRequiredLevel: "LEVEL_1", defaultAllowedRoles: ["SUPPORT_MANAGER", "SUPER_ADMIN"] },
  HIGH_RISK_ACCOUNT_ACTION: { label: "High-risk account action", domain: "SAFETY", sourceType: "PROFILE", defaultRiskLevel: "CRITICAL", defaultRequiredLevel: "LEVEL_3", defaultAllowedRoles: ["SUPPORT_MANAGER", "SUPER_ADMIN"] },

  // ---------- PRIVACY ----------
  DATA_EXPORT_APPROVAL: { label: "Approve a data export", domain: "PRIVACY", sourceType: "PRIVACY_REQUEST", defaultRiskLevel: "HIGH", defaultRequiredLevel: "LEVEL_1", defaultAllowedRoles: ["SUPER_ADMIN"] },
  DELETION_APPROVAL: { label: "Approve a deletion request", domain: "PRIVACY", sourceType: "PRIVACY_REQUEST", defaultRiskLevel: "CRITICAL", defaultRequiredLevel: "LEVEL_3", defaultAllowedRoles: ["SUPER_ADMIN"] },
  BULK_DATA_EXPORT: { label: "Bulk data export", domain: "PRIVACY", sourceType: "PRIVACY_REQUEST", defaultRiskLevel: "CRITICAL", defaultRequiredLevel: "LEVEL_3", defaultAllowedRoles: ["SUPER_ADMIN"] },
  LEGAL_HOLD_OVERRIDE: { label: "Override a legal/admin hold", domain: "PRIVACY", sourceType: "PRIVACY_REQUEST", defaultRiskLevel: "CRITICAL", defaultRequiredLevel: "LEVEL_4", defaultAllowedRoles: ["SUPER_ADMIN"] },
  PRIVACY_OVERRIDE: { label: "General privacy override", domain: "PRIVACY", sourceType: "PRIVACY_REQUEST", defaultRiskLevel: "CRITICAL", defaultRequiredLevel: "LEVEL_3", defaultAllowedRoles: ["SUPER_ADMIN"] },

  // ---------- FINANCE ----------
  REFUND_APPROVAL: { label: "Approve a refund", domain: "FINANCE", sourceType: "PAYMENT", defaultRiskLevel: "HIGH", defaultRequiredLevel: "LEVEL_1", defaultAllowedRoles: ["FINANCE_MANAGER", "SUPER_ADMIN"] },
  LARGE_REFUND_APPROVAL: { label: "Approve a large refund", domain: "FINANCE", sourceType: "PAYMENT", defaultRiskLevel: "CRITICAL", defaultRequiredLevel: "LEVEL_3", defaultAllowedRoles: ["FINANCE_MANAGER", "SUPER_ADMIN"] },
  MANUAL_PAYMENT_APPROVAL: { label: "Approve a manual payment", domain: "FINANCE", sourceType: "PAYMENT", defaultRiskLevel: "MEDIUM", defaultRequiredLevel: "LEVEL_1", defaultAllowedRoles: ["FINANCE_MANAGER", "SUPER_ADMIN"] },
  PRICE_OVERRIDE: { label: "Override a package price", domain: "FINANCE", sourceType: "PAYMENT", defaultRiskLevel: "MEDIUM", defaultRequiredLevel: "LEVEL_2", defaultAllowedRoles: ["FINANCE_MANAGER", "SUPER_ADMIN"] },
  COUPON_OVERRIDE: { label: "Override a coupon rule", domain: "FINANCE", sourceType: "PAYMENT", defaultRiskLevel: "MEDIUM", defaultRequiredLevel: "LEVEL_1", defaultAllowedRoles: ["FINANCE_MANAGER", "SUPER_ADMIN"] },
  SUBSCRIPTION_OVERRIDE: { label: "Override a subscription", domain: "FINANCE", sourceType: "PAYMENT", defaultRiskLevel: "MEDIUM", defaultRequiredLevel: "LEVEL_1", defaultAllowedRoles: ["FINANCE_MANAGER", "SUPER_ADMIN"] },
  PAYMENT_ROLLOUT: { label: "Change payment rollout stage", domain: "FINANCE", sourceType: "PAYMENT", defaultRiskLevel: "CRITICAL", defaultRequiredLevel: "LEVEL_3", defaultAllowedRoles: ["FINANCE_MANAGER", "SUPER_ADMIN"] },
  PAYMENT_DISABLE: { label: "Disable payments (kill switch)", domain: "FINANCE", sourceType: "PAYMENT", defaultRiskLevel: "CRITICAL", defaultRequiredLevel: "LEVEL_2", defaultAllowedRoles: ["FINANCE_MANAGER", "SUPER_ADMIN"] },
  PROVIDER_CONFIGURATION_CHANGE: { label: "Change payment provider configuration", domain: "FINANCE", sourceType: "PAYMENT", defaultRiskLevel: "CRITICAL", defaultRequiredLevel: "LEVEL_4", defaultAllowedRoles: ["SUPER_ADMIN"] },

  // ---------- ADMINISTRATION ----------
  ROLE_ASSIGNMENT: { label: "Assign an admin role", domain: "ADMINISTRATION", sourceType: "ADMIN_USER", defaultRiskLevel: "CRITICAL", defaultRequiredLevel: "LEVEL_4", defaultAllowedRoles: ["SUPER_ADMIN"] },
  PERMISSION_CHANGE: { label: "Change admin permissions", domain: "ADMINISTRATION", sourceType: "ADMIN_USER", defaultRiskLevel: "CRITICAL", defaultRequiredLevel: "LEVEL_4", defaultAllowedRoles: ["SUPER_ADMIN"] },
  SUPER_ADMIN_CHANGE: { label: "Grant or remove Super Admin", domain: "ADMINISTRATION", sourceType: "ADMIN_USER", defaultRiskLevel: "CRITICAL", defaultRequiredLevel: "LEVEL_5", defaultAllowedRoles: ["SUPER_ADMIN"] },
  STAFF_DISABLE: { label: "Disable a staff account", domain: "ADMINISTRATION", sourceType: "ADMIN_USER", defaultRiskLevel: "HIGH", defaultRequiredLevel: "LEVEL_2", defaultAllowedRoles: ["SUPER_ADMIN", "OPERATIONS_ADMIN"] },
  SECURITY_OVERRIDE: { label: "Security override", domain: "ADMINISTRATION", sourceType: "ADMIN_USER", defaultRiskLevel: "CRITICAL", defaultRequiredLevel: "LEVEL_4", defaultAllowedRoles: ["SUPER_ADMIN"] },
  // Not one of spec §6's named 53 actions — added to demonstrate §26's bulk
  // sensitive-action governance (architecture decision 11) on a real batch
  // operation (STEP 18's bulk task archive). Disclosed addition; the
  // catalog is admin-extensible by design (decision 1), not a closed enum.
  BULK_SENSITIVE_TASK_ACTION: { label: "Bulk sensitive task action", domain: "ADMINISTRATION", sourceType: "ADMIN_TASK", defaultRiskLevel: "HIGH", defaultRequiredLevel: "LEVEL_2", defaultAllowedRoles: ["OPERATIONS_ADMIN", "SUPER_ADMIN"] },

  // ---------- AI ----------
  AI_SAFETY_OVERRIDE: { label: "Override an AI safety block", domain: "AI", sourceType: "AI_SAFETY_EVENT", defaultRiskLevel: "CRITICAL", defaultRequiredLevel: "LEVEL_3", defaultAllowedRoles: ["SUPER_ADMIN"] },
  AI_CONFIGURATION_CHANGE: { label: "Change AI configuration", domain: "AI", sourceType: "AI_SAFETY_EVENT", defaultRiskLevel: "HIGH", defaultRequiredLevel: "LEVEL_2", defaultAllowedRoles: ["SUPER_ADMIN"] },
  AI_PROVIDER_CHANGE: { label: "Change AI provider", domain: "AI", sourceType: "AI_SAFETY_EVENT", defaultRiskLevel: "CRITICAL", defaultRequiredLevel: "LEVEL_3", defaultAllowedRoles: ["SUPER_ADMIN"] },
  AI_ROLLOUT: { label: "Change AI rollout phase", domain: "AI", sourceType: "AI_SAFETY_EVENT", defaultRiskLevel: "HIGH", defaultRequiredLevel: "LEVEL_2", defaultAllowedRoles: ["SUPER_ADMIN"] },
  AI_KILL_SWITCH_OVERRIDE: { label: "Use the AI kill switch", domain: "AI", sourceType: "AI_SAFETY_EVENT", defaultRiskLevel: "CRITICAL", defaultRequiredLevel: "LEVEL_2", defaultAllowedRoles: ["SUPER_ADMIN"] },
};

export function getCatalogEntry(actionType: string): CatalogEntry | null {
  return APPROVAL_CATALOG[actionType] ?? null;
}

export function isKnownActionType(actionType: string): boolean {
  return actionType in APPROVAL_CATALOG;
}

// Idempotent — only inserts policies that don't already exist by actionType,
// so re-running (e.g. on every deploy) never overwrites an admin's own edits
// to a policy's required level/quorum/roles. Mirrors
// src/lib/workflow/automation-rules.ts's seedDefaultWorkflowRules() exactly.
export async function seedApprovalPolicies(): Promise<number> {
  const existing = await prisma.approvalPolicy.findMany({ select: { actionType: true } });
  const already = new Set(existing.map((p) => p.actionType));
  const toCreate = Object.entries(APPROVAL_CATALOG).filter(([actionType]) => !already.has(actionType));
  if (toCreate.length === 0) return 0;

  await prisma.approvalPolicy.createMany({
    data: toCreate.map(([actionType, entry]) => ({
      actionType,
      enabled: true,
      riskLevel: entry.defaultRiskLevel,
      requiredLevel: entry.defaultRequiredLevel,
      minimumApprovers: entry.defaultRequiredLevel === "LEVEL_0" ? 0 : 1,
      quorum: 1,
      allowedRoles: entry.defaultAllowedRoles,
      makerCheckerRequired: entry.defaultRequiredLevel !== "LEVEL_0",
      reauthRequired: entry.defaultRiskLevel === "CRITICAL",
      twoFactorRequired: false,
      expirationMinutes: 4320,
      emergencyOverrideAllowed: entry.domain === "SAFETY" || entry.domain === "PRIVACY" || entry.domain === "ADMINISTRATION",
    })),
  });
  return toCreate.length;
}
