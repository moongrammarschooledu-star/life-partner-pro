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

const CATEGORIES_BY_TYPE: Record<CaseType, CaseCategory[]> = {
  SUPPORT: SUPPORT_CATEGORIES,
  COMPLAINT: COMPLAINT_CATEGORIES,
  SAFETY_REPORT: SAFETY_CATEGORIES,
  // Internal cases are staff-initiated and not bound to the applicant-facing
  // category set — any category is acceptable.
  INTERNAL: [...SUPPORT_CATEGORIES, ...COMPLAINT_CATEGORIES, ...SAFETY_CATEGORIES],
};

export function isCategoryValidForType(type: CaseType, category: CaseCategory): boolean {
  return CATEGORIES_BY_TYPE[type].includes(category);
}

export function categoriesForType(type: CaseType): CaseCategory[] {
  return CATEGORIES_BY_TYPE[type];
}
