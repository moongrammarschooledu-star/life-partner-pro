// Canonical, post-registration Profile Completeness score (spec §10) — a
// category-weighted breakdown, distinct from src/lib/profile-completion.ts's
// lightweight live-preview estimator used inside the registration wizard
// (that file operates on partial, unpersisted form state for instant
// per-keystroke feedback; this one operates on a fully loaded Profile +
// relations and is the value persisted to Profile.profileCompletion going
// forward). The two intentionally stay separate — see the comment atop
// profile-completion.ts.

export interface CompletenessCategory {
  key: string;
  label: string;
  weight: number;
  earnedWeight: number;
  missingFields: string[];
}

export interface CompletenessInput {
  fullName: string;
  gender: string;
  dateOfBirth: unknown;
  maritalStatus: string;
  heightCm: number;
  city: string;
  country: string;
  nationality?: string | null;
  area?: string | null;

  contact: { mobileNumber: string; email: string; whatsappNumber?: string | null } | null;
  phoneVerified: boolean;
  emailVerified: boolean;

  education: { level: string; degree?: string | null; institution?: string | null } | null;

  profession: {
    profession: string;
    employmentType: string;
    monthlyIncome?: number | null;
    jobTitle?: string | null;
    companyName?: string | null;
    businessDetails?: string | null;
  } | null;

  family: {
    fatherOccupation?: string | null;
    motherOccupation?: string | null;
    familyType: string;
    familyLocation?: string | null;
    familyBackground?: string | null;
  } | null;

  lifestyle: {
    religion?: string | null;
    languages?: string | null;
    hobbies?: string | null;
    personality?: string | null;
    aboutMe?: string | null;
  } | null;

  preference: {
    minAge?: number | null;
    maxAge?: number | null;
    preferredCity?: string | null;
    preferredCountry?: string | null;
    minEducation?: string | null;
    maritalStatusPreference?: string | null;
    minHeightCm?: number | null;
    maxHeightCm?: number | null;
  } | null;

  hasPhoto: boolean;
}

const has = (v: unknown): boolean => typeof v === "string" ? v.trim().length > 0 : v != null;

function scoreCategory(key: string, label: string, weight: number, checks: { field: string; present: boolean }[]): CompletenessCategory {
  const total = checks.length;
  const filled = checks.filter((c) => c.present).length;
  const earnedWeight = total === 0 ? weight : Math.round((filled / total) * weight * 100) / 100;
  return {
    key,
    label,
    weight,
    earnedWeight,
    missingFields: checks.filter((c) => !c.present).map((c) => c.field),
  };
}

export function computeProfileCompleteness(input: CompletenessInput): { percent: number; categories: CompletenessCategory[] } {
  const categories: CompletenessCategory[] = [
    scoreCategory("personal", "Personal Information", 20, [
      { field: "Full name", present: has(input.fullName) },
      { field: "Gender", present: has(input.gender) },
      { field: "Date of birth", present: has(input.dateOfBirth) },
      { field: "Marital status", present: has(input.maritalStatus) },
      { field: "Height", present: has(input.heightCm) },
      { field: "City", present: has(input.city) },
      { field: "Country", present: has(input.country) },
      { field: "Nationality", present: has(input.nationality) },
    ]),
    scoreCategory("contact", "Contact", 10, [
      { field: "Mobile number", present: has(input.contact?.mobileNumber) },
      { field: "Email", present: has(input.contact?.email) },
      { field: "WhatsApp number", present: has(input.contact?.whatsappNumber) },
      { field: "Mobile verified", present: input.phoneVerified },
      { field: "Email verified", present: input.emailVerified },
    ]),
    scoreCategory("education", "Education", 15, [
      { field: "Education level", present: has(input.education?.level) },
      { field: "Degree", present: has(input.education?.degree) },
      { field: "Institution", present: has(input.education?.institution) },
    ]),
    scoreCategory("career", "Career", 15, [
      { field: "Profession", present: has(input.profession?.profession) },
      { field: "Employment type", present: has(input.profession?.employmentType) },
      { field: "Income", present: has(input.profession?.monthlyIncome) },
      { field: "Job title / business details", present: has(input.profession?.jobTitle) || has(input.profession?.businessDetails) },
    ]),
    scoreCategory("family", "Family", 15, [
      { field: "Father's occupation", present: has(input.family?.fatherOccupation) },
      { field: "Mother's occupation", present: has(input.family?.motherOccupation) },
      { field: "Family type", present: has(input.family?.familyType) },
      { field: "Family location", present: has(input.family?.familyLocation) },
      { field: "Family background", present: has(input.family?.familyBackground) },
    ]),
    scoreCategory("lifestyle", "Lifestyle", 10, [
      { field: "Religion", present: has(input.lifestyle?.religion) },
      { field: "Languages", present: has(input.lifestyle?.languages) },
      { field: "Hobbies", present: has(input.lifestyle?.hobbies) },
      { field: "About me", present: has(input.lifestyle?.aboutMe) },
    ]),
    scoreCategory("partner_requirements", "Partner Requirements", 10, [
      { field: "Age range", present: has(input.preference?.minAge) && has(input.preference?.maxAge) },
      { field: "Preferred location", present: has(input.preference?.preferredCity) || has(input.preference?.preferredCountry) },
      { field: "Minimum education", present: has(input.preference?.minEducation) },
      { field: "Marital status preference", present: has(input.preference?.maritalStatusPreference) },
      { field: "Height range", present: has(input.preference?.minHeightCm) && has(input.preference?.maxHeightCm) },
    ]),
    scoreCategory("photo", "Photo", 5, [{ field: "Profile photo", present: input.hasPhoto }]),
  ];

  const percent = Math.round(categories.reduce((sum, c) => sum + c.earnedWeight, 0));
  return { percent: Math.max(0, Math.min(100, percent)), categories };
}
