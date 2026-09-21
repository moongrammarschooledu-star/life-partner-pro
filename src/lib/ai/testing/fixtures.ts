import type { AiProfileView } from "@/lib/ai/profile-view";
import type { MatchableProfile } from "@/lib/matching";

// Synthetic, non-production profiles for AI tests and the quality/regression
// harness (spec §63). Nothing here is real member data.

let counter = 0;

export function makeView(over: Partial<AiProfileView> = {}, prefOver: Partial<AiProfileView["preference"]> = {}): AiProfileView {
  counter += 1;
  const n = String(counter).padStart(4, "0");
  const base: AiProfileView = {
    profileId: `synthetic-profile-${n}`,
    profileCode: `LPP-SYN-${n}`,
    ref: `Profile ${String.fromCharCode(64 + (((counter - 1) % 4) + 1))}`,
    status: "ACTIVE",
    gender: "FEMALE",
    age: 27,
    dateOfBirthValid: true,
    heightCm: 162,
    maritalStatus: "NEVER_MARRIED",
    hasChildren: null,
    numberOfChildren: null,
    city: "Lahore",
    area: "Model Town",
    country: "Pakistan",
    nationality: "Pakistani",
    educationLevel: "Masters",
    degree: "MBA",
    institution: "Synthetic University",
    profession: "Teacher",
    employmentType: "PRIVATE",
    jobTitle: "Senior Teacher",
    companyName: "Synthetic School",
    workLocation: "Lahore",
    monthlyIncome: 120000,
    familyType: "NUCLEAR",
    familyStatus: "MIDDLE_CLASS",
    numberOfBrothers: 1,
    numberOfSisters: 1,
    fatherOccupation: "Retired officer",
    motherOccupation: "Homemaker",
    familyLocation: "Lahore",
    familyBackground: "A close-knit family.",
    religion: "Islam",
    sect: "Sunni",
    religiousPractice: "Practicing",
    languages: "Urdu, English",
    smoking: false,
    drinking: false,
    hobbies: "Reading, travel",
    personality: "Calm, family oriented",
    aboutMe: "I enjoy teaching and spending time with family.",
    preference: {
      minAge: 27,
      maxAge: 35,
      preferredCountry: "Pakistan",
      preferredCity: "Lahore",
      preferredArea: null,
      minEducation: "Bachelors",
      preferredEducation: null,
      professionPreference: "ANY",
      minIncome: null,
      maxIncome: null,
      incomeFlexible: true,
      maritalStatusPreference: "NEVER_MARRIED",
      minHeightCm: 165,
      maxHeightCm: 190,
      familyTypePreference: "ANY",
      familyBackgroundPreference: "ANY",
      locationScope: null,
      additionalExpectations: "Looking for a respectful and family oriented partner.",
      ...prefOver,
    },
    hasPreference: true,
    hasEducationRecord: true,
    hasProfessionRecord: true,
    hasFamilyRecord: true,
    hasLifestyleRecord: true,
    verification: { status: "VERIFIED", phoneVerified: true, emailVerified: true, approvedChecklistItems: ["Identity document checked"] },
    completenessPercent: 92,
    updatedAt: "2026-09-01T00:00:00.000Z",
    hidden: { income: false, familyDetails: false },
  };
  return { ...base, ...over, preference: base.preference };
}

export function makeMatchable(v: AiProfileView): MatchableProfile {
  return {
    id: v.profileId,
    gender: v.gender as "MALE" | "FEMALE",
    age: v.age,
    heightCm: v.heightCm ?? 0,
    maritalStatus: v.maritalStatus,
    city: v.city,
    area: v.area,
    country: v.country,
    educationLevel: v.educationLevel,
    profession: v.profession,
    monthlyIncome: v.hidden.income ? null : v.monthlyIncome,
    familyType: v.familyType,
    familyStatus: v.familyStatus,
    religion: v.religion,
    sect: v.sect,
    smoking: v.smoking ?? undefined,
    drinking: v.drinking ?? undefined,
    languages: v.languages,
    preference: {
      minAge: v.preference.minAge,
      maxAge: v.preference.maxAge,
      preferredCountry: v.preference.preferredCountry,
      preferredCity: v.preference.preferredCity,
      preferredArea: v.preference.preferredArea,
      minEducation: v.preference.minEducation,
      professionPreference: v.preference.professionPreference,
      minIncome: v.hidden.income ? null : v.preference.minIncome,
      maxIncome: v.hidden.income ? null : v.preference.maxIncome,
      incomeFlexible: v.preference.incomeFlexible ?? undefined,
      maritalStatusPreference: v.preference.maritalStatusPreference,
      minHeightCm: v.preference.minHeightCm,
      maxHeightCm: v.preference.maxHeightCm,
      familyTypePreference: v.preference.familyTypePreference,
      familyBackgroundPreference: v.preference.familyBackgroundPreference,
    },
  };
}

export function malePartner(over: Partial<AiProfileView> = {}, prefOver: Partial<AiProfileView["preference"]> = {}): AiProfileView {
  return makeView(
    { gender: "MALE", age: 30, heightCm: 178, profession: "Engineer", educationLevel: "Bachelors", degree: "BSc Engineering", jobTitle: "Software Engineer", monthlyIncome: 250000, ...over },
    { minAge: 24, maxAge: 30, minHeightCm: null, maxHeightCm: null, minEducation: "Masters", ...prefOver }
  );
}
