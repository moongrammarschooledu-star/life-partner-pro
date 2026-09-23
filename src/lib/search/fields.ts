import type { Permission } from "@/lib/permissions";

// STEP 20 §18 — the single allow-list every search surface (Smart Filter
// Builder, quick filters, AI-assisted search's confirmation display) is
// validated against. Sensitive fields (income, contact, exact address,
// private notes/documents) are never listed here at all — filtering on them
// requires the dedicated, separately-permission-gated income/family
// parameters on searchProfiles() (src/lib/search/candidate-search.ts), never
// this generic allow-list. A field tagged `sensitivePermission` may appear
// here (family/religious background) because it IS reachable through the
// builder, just gated per-use — unlike income/contact, which are excluded
// by omission, not by a runtime check.

export type FieldType = "string" | "number" | "boolean" | "enum" | "date";
export type ComparisonOp = "eq" | "neq" | "contains" | "gte" | "lte" | "in" | "between";

export interface SearchableFieldDef {
  field: string;
  label: string;
  type: FieldType;
  ops: ComparisonOp[];
  enumValues?: readonly string[];
  sensitivePermission?: Permission;
}

// spec §6 — RESTRICTED is not a ProfileStatus value in this schema; a
// restriction is tracked separately via ProfileRestriction (STEP 12) and is
// excluded from discovery by default via that mechanism (see
// src/lib/search/candidate-search.ts's default exclusion), not via a status
// filter here.
export const PROFILE_STATUSES = [
  "NEW", "UNDER_REVIEW", "VERIFIED", "ACTIVE", "MATCHING", "PROPOSAL_SENT",
  "WAITING_FOR_RESPONSE", "INTERESTED", "NOT_INTERESTED", "MEETING_ARRANGED",
  "FINALIZED", "MARRIED", "REJECTED", "ARCHIVED", "SUSPENDED",
] as const;

export const VERIFICATION_STATUSES = [
  "NOT_VERIFIED", "VERIFICATION_PENDING", "UNDER_REVIEW", "VERIFICATION_REQUIRED",
  "VERIFIED", "VERIFICATION_REJECTED", "VERIFICATION_EXPIRED", "RE_VERIFICATION_REQUIRED",
] as const;

export const MARITAL_STATUSES = ["NEVER_MARRIED", "DIVORCED", "WIDOWED", "ANNULLED", "SEPARATED", "OTHER"] as const;
export const EMPLOYMENT_TYPES = ["GOVERNMENT", "PRIVATE", "BUSINESS_OWNER", "SELF_EMPLOYED", "FREELANCE", "NOT_WORKING", "STUDENT"] as const;

// spec §9 — a small ordered reference list for ">=" ordinal comparison
// (`Education >= Bachelor'`), not a new admin-configurable-options table
// (disclosed simplification — see the STEP 20 plan's decision 10). Education
// level itself stays free text on EducationInfo.level; this is a display/
// comparison aid, not a stored enum.
export const EDUCATION_LEVEL_ORDER = ["Matric", "Intermediate", "Diploma", "Bachelors", "Masters", "MPhil", "PhD"] as const;

export function educationLevelRank(level: string | null | undefined): number {
  if (!level) return -1;
  const idx = EDUCATION_LEVEL_ORDER.findIndex((l) => l.toLowerCase() === level.toLowerCase());
  return idx;
}

export const SEARCHABLE_FIELDS: Record<string, SearchableFieldDef> = {
  fullName: { field: "fullName", label: "Name", type: "string", ops: ["contains", "eq"] },
  profileCode: { field: "profileCode", label: "Profile ID", type: "string", ops: ["eq"] },
  gender: { field: "gender", label: "Gender", type: "enum", ops: ["eq", "in"], enumValues: ["MALE", "FEMALE"] },
  age: { field: "age", label: "Age", type: "number", ops: ["eq", "gte", "lte", "between"] },
  maritalStatus: { field: "maritalStatus", label: "Marital Status", type: "enum", ops: ["eq", "in"], enumValues: MARITAL_STATUSES },
  heightCm: { field: "heightCm", label: "Height (cm)", type: "number", ops: ["gte", "lte", "between"] },
  city: { field: "city", label: "City", type: "string", ops: ["eq", "in", "contains"] },
  area: { field: "area", label: "Area", type: "string", ops: ["eq", "in", "contains"] },
  country: { field: "country", label: "Country", type: "string", ops: ["eq", "in"] },
  status: { field: "status", label: "Profile Status", type: "enum", ops: ["eq", "in"], enumValues: PROFILE_STATUSES },
  verificationStatus: { field: "verificationStatus", label: "Verification Status", type: "enum", ops: ["eq", "in"], enumValues: VERIFICATION_STATUSES },
  verified: { field: "verified", label: "Verified Only", type: "boolean", ops: ["eq"] },

  educationLevel: { field: "educationLevel", label: "Education Level", type: "string", ops: ["eq", "in", "gte"] },
  degree: { field: "degree", label: "Degree", type: "string", ops: ["contains"] },
  institution: { field: "institution", label: "Institution", type: "string", ops: ["contains"] },

  profession: { field: "profession", label: "Profession", type: "string", ops: ["eq", "contains"] },
  jobTitle: { field: "jobTitle", label: "Job Title", type: "string", ops: ["contains"] },
  companyName: { field: "companyName", label: "Company/Business", type: "string", ops: ["contains"] },
  employmentType: { field: "employmentType", label: "Employment Type", type: "enum", ops: ["eq", "in"], enumValues: EMPLOYMENT_TYPES },
  workLocation: { field: "workLocation", label: "Work Location", type: "string", ops: ["contains"] },

  languages: { field: "languages", label: "Languages", type: "string", ops: ["contains"] },
  smoking: { field: "smoking", label: "Smoking", type: "boolean", ops: ["eq"] },
  drinking: { field: "drinking", label: "Drinking", type: "boolean", ops: ["eq"] },

  // spec §12/§13 — religion/sect/family background are legitimately
  // searchable but privacy-controlled: reaching them through the builder
  // requires sensitive:family:view, checked by validateFilterGroup().
  religion: { field: "religion", label: "Religious Preference", type: "string", ops: ["eq", "contains"], sensitivePermission: "sensitive:family:view" },
  sect: { field: "sect", label: "Sect/School", type: "string", ops: ["eq", "contains"], sensitivePermission: "sensitive:family:view" },
  religiousPractice: { field: "religiousPractice", label: "Religious Practice", type: "string", ops: ["eq", "contains"], sensitivePermission: "sensitive:family:view" },
  familyType: { field: "familyType", label: "Family Type", type: "enum", ops: ["eq", "in"], enumValues: ["NUCLEAR", "JOINT", "EXTENDED"], sensitivePermission: "sensitive:family:view" },
  familyStatus: { field: "familyStatus", label: "Family Background", type: "enum", ops: ["eq", "in"], enumValues: ["MIDDLE_CLASS", "UPPER_MIDDLE_CLASS", "UPPER_CLASS", "WELL_SETTLED"], sensitivePermission: "sensitive:family:view" },
  fatherOccupation: { field: "fatherOccupation", label: "Father's Occupation", type: "string", ops: ["contains"], sensitivePermission: "sensitive:family:view" },
  motherOccupation: { field: "motherOccupation", label: "Mother's Occupation", type: "string", ops: ["contains"], sensitivePermission: "sensitive:family:view" },
};

export function getFieldDef(field: string): SearchableFieldDef | null {
  return SEARCHABLE_FIELDS[field] ?? null;
}
