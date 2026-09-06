import type { Prisma } from "@prisma/client";
import type { ReportFilters, DateRangePreset } from "@/lib/reports/types";
import { resolveDateRange } from "@/lib/reports/date-range";

// Parses the 11-filter vocabulary (spec §1) + date-range preset/custom out
// of a request's query string. Shared by every Reports section route so the
// URL-driven filter bar behaves identically everywhere.
export function parseReportFilters(searchParams: URLSearchParams): ReportFilters {
  const preset = (searchParams.get("preset") as DateRangePreset | null) ?? "30d";
  const dateRange = resolveDateRange(preset, searchParams.get("from"), searchParams.get("to"));

  const num = (key: string) => {
    const v = searchParams.get(key);
    return v ? Number(v) : undefined;
  };
  const str = (key: string) => searchParams.get(key)?.trim() || undefined;

  return {
    city: str("city"),
    area: str("area"),
    gender: str("gender"),
    minAge: num("minAge"),
    maxAge: num("maxAge"),
    profession: str("profession"),
    education: str("education"),
    maritalStatus: str("maritalStatus"),
    profileStatus: str("profileStatus"),
    verificationStatus: str("verificationStatus"),
    staffId: str("staffId"),
    proposalStatus: str("proposalStatus"),
    dateRange,
  };
}

function dobRangeFromAge(minAge?: number, maxAge?: number): Prisma.DateTimeFilter | undefined {
  if (minAge == null && maxAge == null) return undefined;
  const now = new Date();
  const dobFilter: Prisma.DateTimeFilter = {};
  if (maxAge != null) dobFilter.gte = new Date(now.getFullYear() - maxAge - 1, now.getMonth(), now.getDate());
  if (minAge != null) dobFilter.lte = new Date(now.getFullYear() - minAge, now.getMonth(), now.getDate());
  return dobFilter;
}

// The profile-attribute subset of the 11 filters, reused (nested) by every
// other model's where-builder below.
function buildProfileAttributeWhere(filters: ReportFilters): Prisma.ProfileWhereInput {
  const dob = dobRangeFromAge(filters.minAge, filters.maxAge);
  return {
    ...(filters.city ? { city: { contains: filters.city, mode: "insensitive" } } : {}),
    ...(filters.area ? { area: { contains: filters.area, mode: "insensitive" } } : {}),
    ...(filters.gender ? { gender: filters.gender as never } : {}),
    ...(filters.maritalStatus ? { maritalStatus: filters.maritalStatus as never } : {}),
    ...(filters.profileStatus ? { status: filters.profileStatus as never } : {}),
    ...(filters.profession ? { profession: { is: { profession: { contains: filters.profession, mode: "insensitive" } } } } : {}),
    ...(filters.education ? { education: { is: { level: { contains: filters.education, mode: "insensitive" } } } } : {}),
    ...(dob ? { dateOfBirth: dob } : {}),
  };
}

export function buildProfileWhere(filters: ReportFilters): Prisma.ProfileWhereInput {
  return {
    softDeleted: false,
    ...buildProfileAttributeWhere(filters),
    createdAt: { gte: filters.dateRange.from, lte: filters.dateRange.to },
  };
}

export function buildVerificationWhere(filters: ReportFilters): Prisma.ProfileVerificationWhereInput {
  const profileAttrs = buildProfileAttributeWhere(filters);
  return {
    ...(filters.verificationStatus ? { status: filters.verificationStatus as never } : {}),
    ...(filters.staffId ? { assignedToId: filters.staffId } : {}),
    createdAt: { gte: filters.dateRange.from, lte: filters.dateRange.to },
    profile: { is: { softDeleted: false, ...profileAttrs } },
  };
}

export function buildMatchWhere(filters: ReportFilters): Prisma.MatchWhereInput {
  const profileAttrs = buildProfileAttributeWhere(filters);
  const hasProfileFilter = Object.keys(profileAttrs).length > 0;
  return {
    createdAt: { gte: filters.dateRange.from, lte: filters.dateRange.to },
    ...(hasProfileFilter
      ? { OR: [{ profileA: { is: profileAttrs } }, { profileB: { is: profileAttrs } }] }
      : {}),
  };
}

export function buildProposalWhere(filters: ReportFilters): Prisma.ProposalWhereInput {
  const profileAttrs = buildProfileAttributeWhere(filters);
  const hasProfileFilter = Object.keys(profileAttrs).length > 0;
  return {
    createdAt: { gte: filters.dateRange.from, lte: filters.dateRange.to },
    ...(filters.proposalStatus ? { status: filters.proposalStatus as never } : {}),
    ...(filters.staffId ? { assignedToId: filters.staffId } : {}),
    ...(hasProfileFilter
      ? { OR: [{ profileA: { is: profileAttrs } }, { profileB: { is: profileAttrs } }] }
      : {}),
  };
}

export function buildMeetingWhere(filters: ReportFilters): Prisma.MeetingWhereInput {
  const profileAttrs = buildProfileAttributeWhere(filters);
  const hasProfileFilter = Object.keys(profileAttrs).length > 0;
  return {
    createdAt: { gte: filters.dateRange.from, lte: filters.dateRange.to },
    ...(filters.staffId ? { createdById: filters.staffId } : {}),
    ...(hasProfileFilter
      ? { proposal: { is: { OR: [{ profileA: { is: profileAttrs } }, { profileB: { is: profileAttrs } }] } } }
      : {}),
    ...(filters.proposalStatus ? { proposal: { is: { status: filters.proposalStatus as never } } } : {}),
  };
}

export function buildFollowUpWhere(filters: ReportFilters): Prisma.FollowUpWhereInput {
  const profileAttrs = buildProfileAttributeWhere(filters);
  const hasProfileFilter = Object.keys(profileAttrs).length > 0;
  return {
    createdAt: { gte: filters.dateRange.from, lte: filters.dateRange.to },
    ...(filters.staffId ? { adminId: filters.staffId } : {}),
    ...(hasProfileFilter ? { profile: { is: profileAttrs } } : {}),
  };
}

export function buildCommunicationWhere(filters: ReportFilters): Prisma.CommunicationLogWhereInput {
  const profileAttrs = buildProfileAttributeWhere(filters);
  const hasProfileFilter = Object.keys(profileAttrs).length > 0;
  return {
    isTest: false,
    createdAt: { gte: filters.dateRange.from, lte: filters.dateRange.to },
    ...(hasProfileFilter ? { profile: { is: profileAttrs } } : {}),
  };
}
