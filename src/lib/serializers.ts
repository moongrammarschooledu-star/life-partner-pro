import type { Prisma } from "@prisma/client";
import { calculateAge } from "@/lib/utils";
import type { Permission } from "@/lib/permissions";

function canViewIncome(permissions: Permission[]): boolean {
  return permissions.includes("sensitive:income:view");
}
function canViewAllNotes(permissions: Permission[]): boolean {
  return permissions.includes("sensitive:notes:view");
}
// STEP 20 — sensitive:family:view existed as a granted permission since
// STEP 17 but was never actually checked by toDetailDto (family/lifestyle
// were returned in full to anyone who could view the profile at all). This
// closes that gap: `family` is nulled entirely, and religion/sect/
// religiousPractice are nulled on `lifestyle` (smoking/drinking/languages/
// hobbies/personality stay visible — spec §13 treats those as softer,
// privacy-controlled-but-not-permission-gated lifestyle fields, distinct
// from the family/religious background spec §12 explicitly gates).
function canViewFamily(permissions: Permission[]): boolean {
  return permissions.includes("sensitive:family:view");
}

// Contact info is intentionally NOT part of this include set — every list
// and detail query in the admin app uses this shape by default. The only
// place ContactInfo is ever fetched is the explicit reveal endpoint.
export const profileListInclude = {
  education: true,
  profession: true,
  photos: { where: { isPrimary: true }, take: 1 },
} satisfies Prisma.ProfileInclude;

export const profileDetailInclude = {
  education: true,
  profession: true,
  family: true,
  lifestyle: true,
  preference: true,
  photos: true,
  notes: { include: { admin: { select: { id: true, name: true } } }, orderBy: [{ pinned: "desc" }, { createdAt: "desc" }] },
  consent: true,
  pendingUpdate: true,
} satisfies Prisma.ProfileInclude;

export type ProfileListItem = Prisma.ProfileGetPayload<{ include: typeof profileListInclude }>;
export type ProfileDetail = Prisma.ProfileGetPayload<{ include: typeof profileDetailInclude }>;

export function toListDto(profile: ProfileListItem, permissions: Permission[] = []) {
  return {
    id: profile.id,
    profileCode: profile.profileCode,
    fullName: profile.fullName,
    gender: profile.gender,
    age: calculateAge(profile.dateOfBirth),
    city: profile.city,
    country: profile.country,
    education: profile.education?.level ?? null,
    profession: profile.profession?.profession ?? null,
    monthlyIncome: canViewIncome(permissions) ? profile.profession?.monthlyIncome ?? null : null,
    status: profile.status,
    verified: profile.verified,
    photoId: profile.photos[0]?.id ?? null,
    createdAt: profile.createdAt,
  };
}

export function toDetailDto(profile: ProfileDetail, viewerAdminId: string, permissions: Permission[] = []) {
  const visibleNotes = canViewAllNotes(permissions) ? profile.notes : profile.notes.filter((n) => n.adminId === viewerAdminId);
  const profession =
    profile.profession && !canViewIncome(permissions)
      ? { ...profile.profession, monthlyIncome: null, annualIncome: null }
      : profile.profession;
  const canFamily = canViewFamily(permissions);
  const family = canFamily ? profile.family : null;
  const lifestyle = profile.lifestyle && !canFamily ? { ...profile.lifestyle, religion: null, sect: null, religiousPractice: null } : profile.lifestyle;

  return {
    id: profile.id,
    profileCode: profile.profileCode,
    fullName: profile.fullName,
    gender: profile.gender,
    dateOfBirth: profile.dateOfBirth,
    age: calculateAge(profile.dateOfBirth),
    maritalStatus: profile.maritalStatus,
    hasChildren: profile.hasChildren,
    numberOfChildren: profile.numberOfChildren,
    heightCm: profile.heightCm,
    city: profile.city,
    area: profile.area,
    country: profile.country,
    nationality: profile.nationality,
    status: profile.status,
    verified: profile.verified,
    softDeleted: profile.softDeleted,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    education: profile.education,
    profession,
    family,
    lifestyle,
    preference: profile.preference,
    photos: profile.photos.map((p) => ({ id: p.id, isPrimary: p.isPrimary })),
    notes: visibleNotes.map((n) => ({
      id: n.id,
      text: n.text,
      pinned: n.pinned,
      createdAt: n.createdAt,
      adminName: n.admin.name,
      isOwnNote: n.adminId === viewerAdminId,
    })),
    hasConsent: !!profile.consent,
    pendingUpdate: profile.pendingUpdate
      ? { id: profile.pendingUpdate.id, payload: JSON.parse(profile.pendingUpdate.payload), submittedAt: profile.pendingUpdate.submittedAt }
      : null,
  };
}

export type ProfileListDto = ReturnType<typeof toListDto>;
export type ProfileDetailDto = ReturnType<typeof toDetailDto>;

// STEP 20 §22 — the compact Candidate Discovery card shape. Reuses toListDto
// verbatim for redaction (never duplicates the income check) and reuses the
// existing authenticated photo proxy route as the image source (spec §24 —
// no new signed-URL scheme; see src/app/api/admin/profiles/[id]/photo/[photoId]/route.ts).
export function toCandidateCardDto(profile: ProfileListItem, permissions: Permission[] = []) {
  const base = toListDto(profile, permissions);
  const primaryPhotoId = profile.photos[0]?.id ?? null;
  return {
    ...base,
    photoUrl: primaryPhotoId ? `/api/admin/profiles/${profile.id}/photo/${primaryPhotoId}` : null,
    profileCompletion: profile.profileCompletion,
  };
}

export type CandidateCardDto = ReturnType<typeof toCandidateCardDto>;
