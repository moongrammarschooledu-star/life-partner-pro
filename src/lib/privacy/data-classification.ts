import type { DataClassification } from "@prisma/client";

// Spec §2 — a documented reference lookup, not a runtime ABAC/policy engine
// (confirmed scope decision: this codebase's established architecture is
// flat role permissions + row-scoping via *-access.ts helpers, not a
// policy layer). Used to label PrivacyAccessLog entries and to decide which
// new sensitive:* permission gates were added — actual enforcement stays on
// the existing/extended permission system.
export const DATA_CLASSIFICATION: Record<string, DataClassification> = {
  profileId: "PUBLIC",
  profileCode: "PUBLIC",
  profileStatus: "PUBLIC",

  staffAssignment: "INTERNAL",
  caseWorkflowStatus: "INTERNAL",
  auditLog: "INTERNAL",

  education: "CONFIDENTIAL",
  profession: "CONFIDENTIAL",
  familyBackground: "CONFIDENTIAL",
  partnerPreferences: "CONFIDENTIAL",
  lifestyle: "CONFIDENTIAL",

  mobileNumber: "HIGHLY_SENSITIVE",
  whatsappNumber: "HIGHLY_SENSITIVE",
  email: "HIGHLY_SENSITIVE",
  exactAddress: "HIGHLY_SENSITIVE",
  monthlyIncome: "HIGHLY_SENSITIVE",
  profilePhoto: "HIGHLY_SENSITIVE",
  verificationDocument: "HIGHLY_SENSITIVE",
  internalNote: "HIGHLY_SENSITIVE",
  caseEvidence: "HIGHLY_SENSITIVE",
  securityFlag: "HIGHLY_SENSITIVE",

  securityInvestigation: "RESTRICTED",
  caseInternalNoteSeniorTier: "RESTRICTED",
  staffConductCase: "RESTRICTED",
  breakGlassGrant: "RESTRICTED",
};

export function classify(field: string): DataClassification {
  return DATA_CLASSIFICATION[field] ?? "CONFIDENTIAL";
}
