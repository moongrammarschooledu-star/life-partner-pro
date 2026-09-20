import type { CaseCategory, CaseType } from "@prisma/client";

// Single source of truth for which category belongs to which case type
// (spec §3/§4/§5) — used both for create-route validation and the
// applicant-facing category picker (so the UI only ever offers a category
// valid for the type the user is filing).
export const SUPPORT_CATEGORIES: CaseCategory[] = [
  "ACCOUNT_PROBLEM",
  "PROFILE_PROBLEM",
  "PROFILE_UPDATE",
  "VERIFICATION_ISSUE",
  "MATCHING_ISSUE",
  "PROPOSAL_ISSUE",
  "CONTACT_PERMISSION_ISSUE",
  "MEETING_ISSUE",
  "COMMUNICATION_ISSUE",
  "TECHNICAL_PROBLEM",
  "PRIVACY_REQUEST",
  "PAYMENT_BILLING",
  "ASSISTED_MATCHMAKING_REQUEST",
  "OTHER_SUPPORT",
];

export const COMPLAINT_CATEGORIES: CaseCategory[] = [
  "INCORRECT_PROFILE_INFORMATION",
  "MISLEADING_INFORMATION",
  "UNWANTED_CONTACT",
  "INAPPROPRIATE_BEHAVIOR",
  "MISUSE_OF_PLATFORM",
  "HARASSMENT",
  "FRAUD_SUSPICIOUS_ACTIVITY",
  "PRIVACY_CONCERN",
  "FAKE_IMPERSONATION_PROFILE",
  "UNAUTHORIZED_CONTACT_SHARING",
  "STAFF_CONDUCT_COMPLAINT",
  "PROPOSAL_RELATED_COMPLAINT",
  "MEETING_RELATED_COMPLAINT",
  "OTHER_COMPLAINT",
];

export const SAFETY_CATEGORIES: CaseCategory[] = [
  "HARASSMENT",
  "THREATENING_BEHAVIOR",
  "FRAUD_SUSPICIOUS_ACTIVITY",
  "FINANCIAL_SCAM",
  "IDENTITY_MISREPRESENTATION",
  "FAKE_PROFILE",
  "BLACKMAIL",
  "UNAUTHORIZED_CONTACT",
  "PRIVACY_VIOLATION",
  "SUSPICIOUS_MEETING_BEHAVIOR",
  "OTHER_SAFETY_CONCERN",
];

// Privacy incidents (STEP 13 spec §27) — own curated list, matching the
// SUPPORT/COMPLAINT/SAFETY pattern rather than INTERNAL's open-ended set.
export const PRIVACY_INCIDENT_CATEGORIES: CaseCategory[] = [
  "UNAUTHORIZED_DATA_ACCESS",
  "CONTACT_DATA_EXPOSURE",
  "PHOTO_EXPOSURE",
  "DOCUMENT_EXPOSURE",
  "INCORRECT_PERMISSION",
  "DATA_EXPORT_ISSUE",
  "NOTIFICATION_PRIVACY_ISSUE",
  "STAFF_ACCESS_VIOLATION",
  "SECURITY_BREACH",
  "OTHER_PRIVACY_INCIDENT",
];

// Payment incidents (STEP 14 rollout-phases add-on §82) — system-detected
// ops/staff-facing payment problems, folded into INTERNAL's open-ended set
// (not their own CaseType, unlike PRIVACY_INCIDENT — see schema.prisma).
export const PAYMENT_INCIDENT_CATEGORIES: CaseCategory[] = [
  "PROVIDER_OUTAGE",
  "PAYMENT_VERIFICATION_FAILURE",
  "DUPLICATE_CHARGE",
  "REFUND_FAILURE",
  "WEBHOOK_FAILURE",
  "SUBSCRIPTION_ERROR",
  "INVOICE_ERROR",
  "RECONCILIATION_MISMATCH",
];

// System incidents (STEP 15 spec §40) — CaseType.SYSTEM_INCIDENT. Payment and
// security incident kinds reuse categories that already exist above.
export const SYSTEM_INCIDENT_CATEGORIES: CaseCategory[] = [
  "APPLICATION_OUTAGE",
  "DATABASE_FAILURE",
  "STORAGE_FAILURE",
  "SECURITY_BREACH",
  "PROVIDER_OUTAGE",
  "WEBHOOK_FAILURE",
  "RECONCILIATION_MISMATCH",
  "NOTIFICATION_INCIDENT",
  "BACKUP_FAILURE",
  "DEPLOYMENT_FAILURE",
  "DATA_INTEGRITY_INCIDENT",
];

const CATEGORIES_BY_TYPE: Record<CaseType, CaseCategory[]> = {
  SUPPORT: SUPPORT_CATEGORIES,
  COMPLAINT: COMPLAINT_CATEGORIES,
  SAFETY_REPORT: SAFETY_CATEGORIES,
  PRIVACY_INCIDENT: PRIVACY_INCIDENT_CATEGORIES,
  SYSTEM_INCIDENT: SYSTEM_INCIDENT_CATEGORIES,
  // Internal cases are staff-initiated and not bound to the applicant-facing
  // category set — any category is acceptable.
  INTERNAL: [
    ...SUPPORT_CATEGORIES,
    ...COMPLAINT_CATEGORIES,
    ...SAFETY_CATEGORIES,
    ...PRIVACY_INCIDENT_CATEGORIES,
    ...PAYMENT_INCIDENT_CATEGORIES,
    ...SYSTEM_INCIDENT_CATEGORIES,
  ],
};

export function isCategoryValidForType(type: CaseType, category: CaseCategory): boolean {
  return CATEGORIES_BY_TYPE[type].includes(category);
}

export function categoriesForType(type: CaseType): CaseCategory[] {
  return CATEGORIES_BY_TYPE[type];
}
