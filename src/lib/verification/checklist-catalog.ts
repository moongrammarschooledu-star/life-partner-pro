// The fixed 17-item verification checklist (spec §3) — a static catalog,
// not DB-defined labels, so admin UI and validation always agree on exactly
// what "the checklist" means. VerificationItem rows are keyed by `key` here.
// Never includes anything resembling facial/appearance scoring.

export type ChecklistCategory = "identity" | "contact" | "profile_info" | "photo";

export interface ChecklistCatalogEntry {
  key: string;
  category: ChecklistCategory;
  label: string;
  requiresDocument: boolean;
  // True for the 3 contact items that are normally auto-completed by the
  // OTP/email-link flow rather than manually ticked by an admin.
  autoCompletedByVerification: boolean;
}

export const CHECKLIST_CATEGORY_LABEL: Record<ChecklistCategory, string> = {
  identity: "Identity / Basic Information",
  contact: "Contact Verification",
  profile_info: "Profile Information",
  photo: "Photo",
};

export const CHECKLIST_CATALOG: ChecklistCatalogEntry[] = [
  // Identity / Basic Information
  { key: "name_reviewed", category: "identity", label: "Name information reviewed", requiresDocument: true, autoCompletedByVerification: false },
  { key: "dob_reviewed", category: "identity", label: "Date of birth reviewed", requiresDocument: false, autoCompletedByVerification: false },
  { key: "gender_confirmed", category: "identity", label: "Gender confirmed", requiresDocument: false, autoCompletedByVerification: false },
  { key: "marital_status_reviewed", category: "identity", label: "Marital status reviewed", requiresDocument: false, autoCompletedByVerification: false },
  { key: "city_area_reviewed", category: "identity", label: "City/area reviewed", requiresDocument: false, autoCompletedByVerification: false },

  // Contact Verification
  { key: "mobile_verified", category: "contact", label: "Mobile verified", requiresDocument: false, autoCompletedByVerification: true },
  { key: "whatsapp_verified", category: "contact", label: "WhatsApp verified", requiresDocument: false, autoCompletedByVerification: true },
  { key: "email_verified", category: "contact", label: "Email verified", requiresDocument: false, autoCompletedByVerification: true },

  // Profile Information
  { key: "education_reviewed", category: "profile_info", label: "Education reviewed", requiresDocument: true, autoCompletedByVerification: false },
  { key: "profession_reviewed", category: "profile_info", label: "Profession reviewed", requiresDocument: false, autoCompletedByVerification: false },
  { key: "employment_reviewed", category: "profile_info", label: "Employment/business information reviewed", requiresDocument: true, autoCompletedByVerification: false },
  { key: "family_reviewed", category: "profile_info", label: "Family information reviewed", requiresDocument: false, autoCompletedByVerification: false },
  { key: "partner_requirements_reviewed", category: "profile_info", label: "Partner requirements reviewed", requiresDocument: false, autoCompletedByVerification: false },

  // Photo
  { key: "photo_uploaded", category: "photo", label: "Profile photo uploaded", requiresDocument: false, autoCompletedByVerification: false },
  { key: "photo_quality_acceptable", category: "photo", label: "Photo quality acceptable", requiresDocument: false, autoCompletedByVerification: false },
  { key: "photo_belongs_to_applicant", category: "photo", label: "Photo belongs to applicant", requiresDocument: false, autoCompletedByVerification: false },
  { key: "photo_meets_guidelines", category: "photo", label: "Photo meets platform guidelines", requiresDocument: false, autoCompletedByVerification: false },
];

export function catalogEntry(key: string): ChecklistCatalogEntry | undefined {
  return CHECKLIST_CATALOG.find((c) => c.key === key);
}

export const CHECKLIST_KEYS = CHECKLIST_CATALOG.map((c) => c.key);
