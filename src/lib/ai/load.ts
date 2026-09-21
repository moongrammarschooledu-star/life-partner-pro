import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError, type SessionAdmin } from "@/lib/route-guard";
import { assertProfileAssignmentAccess } from "@/lib/profile-assignment-access";
import { hasActiveRestriction } from "@/lib/profile-restrictions";
import { calculateAge } from "@/lib/utils";
import { catalogEntry } from "@/lib/verification/checklist-catalog";
import { toMatchable, matchableInclude } from "@/lib/match-adapter";
import type { MatchableProfile } from "@/lib/matching";
import type { AiProfileView } from "@/lib/ai/profile-view";
import { forbiddenStringsFor } from "@/lib/ai/profile-view";

// Spec §17 — permission-aware data loading. The chain is:
//   authentication (requireAdmin, done by the route)
//   → role/permission (ai:* checked in availability + pipeline)
//   → assignment/sharing (assertProfileAssignmentAccess for STAFF)
//   → sensitive-field permission (income / family details / notes)
//   → consent (src/lib/ai/consent.ts)
// A field the admin cannot see is NEVER loaded into the view, so it cannot
// reach analysis, a prompt or a provider. Failure = ApiError(403), and no
// provider is called.

const include = {
  ...matchableInclude,
  verification: { include: { items: true } },
} satisfies Prisma.ProfileInclude;

type ProfileRecord = Prisma.ProfileGetPayload<{ include: typeof include }>;

export interface LoadedProfile {
  view: AiProfileView;
  matchable: MatchableProfile; // engine input — never sent to a provider
}

const REFS = ["Profile A", "Profile B", "Profile C", "Profile D"];

export function canSeeIncome(admin: Pick<SessionAdmin, "permissions">): boolean {
  return admin.permissions.includes("sensitive:income:view");
}
export function canSeeFamilyDetails(admin: Pick<SessionAdmin, "permissions">): boolean {
  return admin.permissions.includes("sensitive:family:view");
}

export function buildView(p: ProfileRecord, admin: Pick<SessionAdmin, "permissions">, ref: string): AiProfileView {
  const income = canSeeIncome(admin);
  const family = canSeeFamilyDetails(admin);
  const pref = p.preference;
  const dobOk = !Number.isNaN(p.dateOfBirth.getTime()) && p.dateOfBirth <= new Date();
  const verification = p.verification
    ? {
        status: p.verification.status,
        phoneVerified: !!p.verification.phoneVerifiedAt,
        emailVerified: !!p.verification.emailVerifiedAt,
        approvedChecklistItems: p.verification.items.filter((i) => i.status === "COMPLETED").map((i) => catalogEntry(i.itemKey)?.label ?? i.itemKey),
      }
    : null;

  return {
    profileId: p.id,
    profileCode: p.profileCode,
    ref,
    status: p.status,
    gender: p.gender,
    age: dobOk ? calculateAge(p.dateOfBirth) : 0,
    dateOfBirthValid: dobOk,
    heightCm: p.heightCm ?? null,
    maritalStatus: p.maritalStatus,
    hasChildren: p.hasChildren ?? null,
    numberOfChildren: p.numberOfChildren ?? null,
    city: p.city,
    area: p.area ?? null,
    country: p.country,
    nationality: p.nationality ?? null,
    educationLevel: p.education?.level ?? null,
    degree: p.education?.degree ?? null,
    institution: p.education?.institution ?? null,
    profession: p.profession?.profession ?? null,
    employmentType: p.profession?.employmentType ?? null,
    jobTitle: p.profession?.jobTitle ?? null,
    companyName: p.profession?.companyName ?? null,
    workLocation: p.profession?.workLocation ?? null,
    monthlyIncome: income ? (p.profession?.monthlyIncome ?? null) : null,
    familyType: p.family?.familyType ?? null,
    familyStatus: p.family?.familyStatus ?? null,
    numberOfBrothers: family ? (p.family?.numberOfBrothers ?? null) : null,
    numberOfSisters: family ? (p.family?.numberOfSisters ?? null) : null,
    fatherOccupation: family ? (p.family?.fatherOccupation ?? null) : null,
    motherOccupation: family ? (p.family?.motherOccupation ?? null) : null,
    familyLocation: family ? (p.family?.familyLocation ?? null) : null,
    familyBackground: family ? (p.family?.familyBackground ?? null) : null,
    religion: p.lifestyle?.religion ?? null,
    sect: p.lifestyle?.sect ?? null,
    religiousPractice: p.lifestyle?.religiousPractice ?? null,
    languages: p.lifestyle?.languages ?? null,
    smoking: p.lifestyle?.smoking ?? null,
    drinking: p.lifestyle?.drinking ?? null,
    hobbies: p.lifestyle?.hobbies ?? null,
    personality: p.lifestyle?.personality ?? null,
    aboutMe: p.lifestyle?.aboutMe ?? null,
    preference: {
      minAge: pref?.minAge ?? null,
      maxAge: pref?.maxAge ?? null,
      preferredCountry: pref?.preferredCountry ?? null,
      preferredCity: pref?.preferredCity ?? null,
      preferredArea: pref?.preferredArea ?? null,
      minEducation: pref?.minEducation ?? null,
      preferredEducation: pref?.preferredEducation ?? null,
      professionPreference: pref?.professionPreference ?? null,
      minIncome: income ? (pref?.minIncome ?? null) : null,
      maxIncome: income ? (pref?.maxIncome ?? null) : null,
      incomeFlexible: pref?.incomeFlexible ?? null,
      maritalStatusPreference: pref?.maritalStatusPreference ?? null,
      minHeightCm: pref?.minHeightCm ?? null,
      maxHeightCm: pref?.maxHeightCm ?? null,
      familyTypePreference: pref?.familyTypePreference ?? null,
      familyBackgroundPreference: pref?.familyBackgroundPreference ?? null,
      locationScope: pref?.locationScope ?? null,
      additionalExpectations: pref?.additionalExpectations ?? null,
    },
    hasPreference: !!pref,
    hasEducationRecord: !!p.education,
    hasProfessionRecord: !!p.profession,
    hasFamilyRecord: !!p.family,
    hasLifestyleRecord: !!p.lifestyle,
    verification,
    completenessPercent: p.profileCompletion,
    updatedAt: p.updatedAt.toISOString(),
    hidden: { income: !income, familyDetails: !family },
  };
}

// Loads ONE profile the admin is allowed to analyse, or throws ApiError(403/404).
export async function loadAuthorizedProfile(admin: SessionAdmin, profileId: string, index = 0, opts: { matching?: boolean } = {}): Promise<LoadedProfile> {
  const p = await prisma.profile.findUnique({ where: { id: profileId }, include });
  // A missing/deleted profile and an inaccessible one look identical to the caller (no existence oracle).
  if (!p || p.softDeleted) throw new ApiError(403, "You do not have access to this profile.");
  try {
    await assertProfileAssignmentAccess(admin, profileId); // STAFF: assigned profiles only
  } catch (err) {
    // Same message as "not found" so the response cannot be used to learn which profile codes exist.
    if (err instanceof ApiError && err.status === 403) throw new ApiError(403, "You do not have access to this profile.");
    throw err;
  }
  // A profile restricted from matching (Step 12 case restriction) is also kept out of match-related AI analysis.
  if (opts.matching && admin.role !== "SUPER_ADMIN" && (await hasActiveRestriction(profileId, "CANNOT_MATCH"))) {
    throw new ApiError(403, "This profile is restricted from matching-related processing.");
  }
  const view = buildView(p, admin, REFS[index] ?? `Profile ${index + 1}`);
  // The engine input is built from the RAW record (it needs real income to score),
  // but hidden categories are excluded from the engine run and never displayed.
  return { view, matchable: toMatchable(p) };
}

export async function loadAuthorizedProfiles(admin: SessionAdmin, profileIds: string[], opts: { matching?: boolean } = {}): Promise<LoadedProfile[]> {
  const unique = [...new Set(profileIds)];
  if (unique.length !== profileIds.length) throw new ApiError(400, "Each profile can only be selected once.");
  const out: LoadedProfile[] = [];
  for (let i = 0; i < unique.length; i++) out.push(await loadAuthorizedProfile(admin, unique[i], i, opts));
  return out;
}

// Values the safety filter must catch if a model echoes them: the involved
// profiles' phone / WhatsApp / email and internal-note text. Loaded for the
// filter only — never placed in any prompt or view.
export async function loadForbiddenStrings(profileIds: string[]): Promise<string[]> {
  if (profileIds.length === 0) return [];
  const [contacts, notes] = await Promise.all([
    prisma.contactInfo.findMany({ where: { profileId: { in: profileIds } }, select: { mobileNumber: true, whatsappNumber: true, email: true } }),
    prisma.profileNote.findMany({ where: { profileId: { in: profileIds } }, select: { text: true }, take: 50 }),
  ]);
  const values: Array<string | null | undefined> = [];
  for (const c of contacts) values.push(c.mobileNumber, c.whatsappNumber, c.email);
  for (const n of notes) {
    // Whole notes are long; use the first 60 chars as a fingerprint of the private text.
    values.push(n.text.trim().slice(0, 60));
  }
  return forbiddenStringsFor(values);
}

export function restrictedCategoriesFor(admin: Pick<SessionAdmin, "permissions">): Array<"income"> {
  return canSeeIncome(admin) ? [] : ["income"];
}
