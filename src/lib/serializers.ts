import type { Prisma } from "@prisma/client";
import { calculateAge } from "@/lib/utils";

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
  notes: { include: { admin: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" } },
  consent: true,
  pendingUpdate: true,
} satisfies Prisma.ProfileInclude;

export type ProfileListItem = Prisma.ProfileGetPayload<{ include: typeof profileListInclude }>;
export type ProfileDetail = Prisma.ProfileGetPayload<{ include: typeof profileDetailInclude }>;

export function toListDto(profile: ProfileListItem) {
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
    monthlyIncome: profile.profession?.monthlyIncome ?? null,
    status: profile.status,
    verified: profile.verified,
    photoId: profile.photos[0]?.id ?? null,
    createdAt: profile.createdAt,
  };
}

export function toDetailDto(profile: ProfileDetail) {
  return {
    id: profile.id,
    profileCode: profile.profileCode,
    fullName: profile.fullName,
    gender: profile.gender,
    dateOfBirth: profile.dateOfBirth,
    age: calculateAge(profile.dateOfBirth),
    maritalStatus: profile.maritalStatus,
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
    profession: profile.profession,
    family: profile.family,
    lifestyle: profile.lifestyle,
    preference: profile.preference,
    photos: profile.photos.map((p) => ({ id: p.id, isPrimary: p.isPrimary })),
    notes: profile.notes.map((n) => ({ id: n.id, text: n.text, createdAt: n.createdAt, adminName: n.admin.name })),
    hasConsent: !!profile.consent,
    pendingUpdate: profile.pendingUpdate
      ? { id: profile.pendingUpdate.id, payload: JSON.parse(profile.pendingUpdate.payload), submittedAt: profile.pendingUpdate.submittedAt }
      : null,
  };
}

export type ProfileListDto = ReturnType<typeof toListDto>;
export type ProfileDetailDto = ReturnType<typeof toDetailDto>;
