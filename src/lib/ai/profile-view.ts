import { classify } from "@/lib/privacy/data-classification";
import type { DataClassification } from "@prisma/client";
import type { AiFeatureKey } from "@/lib/ai/versions";

// The ONLY profile shape the AI layer ever handles. It is built by
// loadAuthorizedProfile() (src/lib/ai/load.ts) from what the requesting admin
// is allowed to see: a field the admin cannot see is never loaded, so it cannot
// reach analysis, a prompt or a provider. There is deliberately NO name,
// phone, WhatsApp, email, photo, document, internal note or case evidence here.

export interface AiPreference {
  minAge: number | null;
  maxAge: number | null;
  preferredCountry: string | null;
  preferredCity: string | null;
  preferredArea: string | null;
  minEducation: string | null;
  preferredEducation: string | null;
  professionPreference: string | null;
  minIncome: number | null; // only with sensitive:income:view
  maxIncome: number | null;
  incomeFlexible: boolean | null;
  maritalStatusPreference: string | null;
  minHeightCm: number | null;
  maxHeightCm: number | null;
  familyTypePreference: string | null;
  familyBackgroundPreference: string | null;
  locationScope: string | null;
  additionalExpectations: string | null; // free text — untrusted
}

export interface AiProfileView {
  profileId: string;
  profileCode: string;
  ref: string; // "Profile A" — used in provider prompts instead of any identifier
  status: string;
  gender: string;
  age: number;
  dateOfBirthValid: boolean;
  heightCm: number | null;
  maritalStatus: string;
  hasChildren: boolean | null;
  numberOfChildren: number | null;
  city: string;
  area: string | null;
  country: string;
  nationality: string | null;

  educationLevel: string | null;
  degree: string | null;
  institution: string | null;
  profession: string | null;
  employmentType: string | null;
  jobTitle: string | null;
  companyName: string | null;
  workLocation: string | null;
  monthlyIncome: number | null; // only with sensitive:income:view

  familyType: string | null;
  familyStatus: string | null;
  numberOfBrothers: number | null;
  numberOfSisters: number | null;
  fatherOccupation: string | null; // family details: only with sensitive:family:view
  motherOccupation: string | null;
  familyLocation: string | null;
  familyBackground: string | null;

  religion: string | null;
  sect: string | null;
  religiousPractice: string | null;
  languages: string | null;
  smoking: boolean | null;
  drinking: boolean | null;
  hobbies: string | null;
  personality: string | null;
  aboutMe: string | null;

  preference: AiPreference;
  hasPreference: boolean;
  hasEducationRecord: boolean;
  hasProfessionRecord: boolean;
  hasFamilyRecord: boolean;
  hasLifestyleRecord: boolean;

  // approvedChecklistItems = human-readable titles of verification checklist
  // items a staff member has APPROVED — the only basis for a "Verified" label.
  verification: { status: string; phoneVerified: boolean; emailVerified: boolean; approvedChecklistItems: string[] } | null;
  completenessPercent: number;
  updatedAt: string;

  // Fields the requesting admin may NOT see. Analysis treats these as
  // "not available to you", never as "missing" or "incompatible".
  hidden: { income: boolean; familyDetails: boolean };
}

// ---------------------------------------------------------------------------
// Data minimisation (spec §18/§19/§38)
// ---------------------------------------------------------------------------

export type Processing = "INTERNAL_AND_EXTERNAL" | "INTERNAL_ONLY" | "NEVER";

// Classification → what may happen. Default is the most privacy-preserving
// reading: only PUBLIC/INTERNAL/CONFIDENTIAL may be processed at all, and only
// CONFIDENTIAL-and-below may leave the system, and then only in minimised,
// pseudonymous form with no free text.
export const CLASSIFICATION_POLICY: Record<DataClassification, { internal: boolean; external: boolean; storeInHistory: boolean }> = {
  PUBLIC: { internal: true, external: true, storeInHistory: true },
  INTERNAL: { internal: true, external: true, storeInHistory: true },
  CONFIDENTIAL: { internal: true, external: true, storeInHistory: true },
  HIGHLY_SENSITIVE: { internal: true, external: false, storeInHistory: false },
  RESTRICTED: { internal: false, external: false, storeInHistory: false },
};

// Per-feature field policy (spec §38). "required" is what the feature needs;
// "optional" only improves it; "restricted" is never processed for it.
export interface FieldPolicy {
  required: string[];
  optional: string[];
  restricted: string[];
}

const ALWAYS_RESTRICTED = [
  "fullName",
  "mobileNumber",
  "whatsappNumber",
  "email",
  "exactAddress",
  "profilePhoto",
  "verificationDocument",
  "internalNote",
  "caseEvidence",
  "securityFlag",
  "rejectionNote",
  "paymentDetails",
];

export const FIELD_POLICY: Record<AiFeatureKey, FieldPolicy> = {
  PROFILE_SUMMARY: {
    required: ["age", "gender", "maritalStatus", "city", "country", "educationLevel", "profession", "partnerPreferences"],
    optional: ["lifestyle", "familyBackground", "verificationStatus"],
    restricted: [...ALWAYS_RESTRICTED, "monthlyIncome"],
  },
  MATCH_EXPLANATION: {
    required: ["age", "maritalStatus", "city", "country", "educationLevel", "profession", "partnerPreferences", "heightCm"],
    optional: ["lifestyle", "familyBackground", "verificationStatus", "monthlyIncome"],
    restricted: ALWAYS_RESTRICTED,
  },
  COMPARE: {
    required: ["age", "maritalStatus", "city", "country", "educationLevel", "profession", "partnerPreferences", "heightCm"],
    optional: ["lifestyle", "familyBackground", "verificationStatus", "monthlyIncome"],
    restricted: ALWAYS_RESTRICTED,
  },
  PROPOSAL_ASSISTANT: {
    required: ["age", "maritalStatus", "city", "educationLevel", "profession", "partnerPreferences", "verificationStatus"],
    optional: ["lifestyle", "familyBackground"],
    restricted: [...ALWAYS_RESTRICTED, "monthlyIncome"],
  },
  COMMUNICATION_ASSISTANT: {
    required: ["profileCode"],
    optional: ["preferredLanguage"],
    restricted: [...ALWAYS_RESTRICTED, "monthlyIncome", "familyBackground", "partnerPreferences", "aboutMe"],
  },
  FOLLOWUP_ASSISTANT: {
    required: ["followUpPurpose", "dueDate", "status"],
    optional: ["proposalStatus"],
    restricted: [...ALWAYS_RESTRICTED, "monthlyIncome", "familyBackground"],
  },
  COPILOT: {
    required: [],
    optional: ["age", "city", "educationLevel", "profession", "verificationStatus"],
    restricted: ALWAYS_RESTRICTED,
  },
  REPORT_ASSISTANT: { required: ["aggregateCounts"], optional: [], restricted: [...ALWAYS_RESTRICTED, "individualProfiles"] },
  DATA_QUALITY: {
    required: ["age", "maritalStatus", "educationLevel", "profession", "employmentType", "partnerPreferences"],
    optional: ["lifestyle", "familyBackground"],
    restricted: [...ALWAYS_RESTRICTED, "monthlyIncome"],
  },
  PROFILE_IMPROVEMENT: {
    required: ["completenessSuggestions"],
    optional: ["partnerPreferences"],
    restricted: [...ALWAYS_RESTRICTED, "monthlyIncome"],
  },
};

export function classificationOf(field: string): DataClassification {
  return classify(field);
}

// The pseudonymous, free-text-free shape allowed to leave the system when an
// external provider is enabled AND the profile has explicit AI consent.
// No name, no contact, no area, no institution/company, no income (own or
// preferred), no occupations, no free text, no identifiers.
export interface ExternalProfile {
  ref: string;
  gender: string;
  age: number;
  heightCm: number | null;
  maritalStatus: string;
  hasChildren: boolean | null;
  city: string;
  country: string;
  educationLevel: string | null;
  profession: string | null;
  employmentType: string | null;
  familyType: string | null;
  familyStatus: string | null;
  religion: string | null;
  sect: string | null;
  languages: string | null;
  smoking: boolean | null;
  drinking: boolean | null;
  verified: boolean;
  preference: {
    minAge: number | null;
    maxAge: number | null;
    preferredCountry: string | null;
    preferredCity: string | null;
    minEducation: string | null;
    professionPreference: string | null;
    maritalStatusPreference: string | null;
    minHeightCm: number | null;
    maxHeightCm: number | null;
    familyTypePreference: string | null;
  };
}

export function minimizeForExternal(v: AiProfileView): ExternalProfile {
  return {
    ref: v.ref,
    gender: v.gender,
    age: v.age,
    heightCm: v.heightCm,
    maritalStatus: v.maritalStatus,
    hasChildren: v.hasChildren,
    city: v.city,
    country: v.country,
    educationLevel: v.educationLevel,
    profession: v.profession,
    employmentType: v.employmentType,
    familyType: v.familyType,
    familyStatus: v.familyStatus,
    religion: v.religion,
    sect: v.sect,
    languages: v.languages,
    smoking: v.smoking,
    drinking: v.drinking,
    verified: v.verification?.status === "VERIFIED",
    preference: {
      minAge: v.preference.minAge,
      maxAge: v.preference.maxAge,
      preferredCountry: v.preference.preferredCountry,
      preferredCity: v.preference.preferredCity,
      minEducation: v.preference.minEducation,
      professionPreference: v.preference.professionPreference,
      maritalStatusPreference: v.preference.maritalStatusPreference,
      minHeightCm: v.preference.minHeightCm,
      maxHeightCm: v.preference.maxHeightCm,
      familyTypePreference: v.preference.familyTypePreference,
    },
  };
}

// Verbatim values that must never appear in any AI output — the involved
// profiles' phone / WhatsApp / email / internal-note text. The AiProfileView
// itself never contains them; src/lib/ai/load.ts loads them separately, for the
// safety filter only, so a model cannot echo them back.
export function forbiddenStringsFor(values: Array<string | null | undefined>): string[] {
  return values.map((s) => (s ?? "").trim()).filter((s) => s.length >= 4);
}
