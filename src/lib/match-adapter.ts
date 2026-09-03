import type { Prisma } from "@prisma/client";
import { calculateAge } from "@/lib/utils";
import type { MatchableProfile } from "@/lib/matching";

export const matchableInclude = {
  education: true,
  profession: true,
  family: true,
  lifestyle: true,
  preference: true,
} satisfies Prisma.ProfileInclude;

export type MatchableRecord = Prisma.ProfileGetPayload<{ include: typeof matchableInclude }>;

export function toMatchable(profile: MatchableRecord): MatchableProfile {
  return {
    id: profile.id,
    gender: profile.gender,
    age: calculateAge(profile.dateOfBirth),
    heightCm: profile.heightCm,
    maritalStatus: profile.maritalStatus,
    city: profile.city,
    country: profile.country,
    educationLevel: profile.education?.level,
    profession: profile.profession?.profession,
    monthlyIncome: profile.profession?.monthlyIncome,
    familyType: profile.family?.familyType,
    familyStatus: profile.family?.familyStatus,
    religion: profile.lifestyle?.religion,
    sect: profile.lifestyle?.sect,
    smoking: profile.lifestyle?.smoking,
    drinking: profile.lifestyle?.drinking,
    preference: {
      minAge: profile.preference?.minAge,
      maxAge: profile.preference?.maxAge,
      preferredCountry: profile.preference?.preferredCountry,
      preferredCity: profile.preference?.preferredCity,
      minEducation: profile.preference?.minEducation,
      professionPreference: profile.preference?.professionPreference,
      minIncome: profile.preference?.minIncome,
      maxIncome: profile.preference?.maxIncome,
      incomeFlexible: profile.preference?.incomeFlexible,
      maritalStatusPreference: profile.preference?.maritalStatusPreference,
      minHeightCm: profile.preference?.minHeightCm,
      maxHeightCm: profile.preference?.maxHeightCm,
      familyTypePreference: profile.preference?.familyTypePreference,
      familyBackgroundPreference: profile.preference?.familyBackgroundPreference,
    },
  };
}
