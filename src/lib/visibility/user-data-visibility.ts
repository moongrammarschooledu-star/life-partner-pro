import { prisma } from "@/lib/prisma";
import type { AuditAction, Profile } from "@prisma/client";

// STEP 21 — UserDataVisibilityService. This is the applicant looking at
// their OWN data, so (unlike ProposalVisibilityService, which narrows what
// one applicant sees of ANOTHER'S profile) there is no permission-based
// redaction here — the concern is completeness and shape, not hiding
// fields from the owner.

export interface SelfStatusView {
  profileCode: string;
  status: string;
  verified: boolean;
  profileCompletion: number;
  createdAt: Date;
}

// Generalizes /api/my-status's statusPayload() — kept field-identical so
// that route's existing behavior is unaffected if it later adopts this.
export function projectSelfStatus(profile: Pick<Profile, "profileCode" | "status" | "verified" | "profileCompletion" | "createdAt">): SelfStatusView {
  return {
    profileCode: profile.profileCode,
    status: profile.status,
    verified: profile.verified,
    profileCompletion: profile.profileCompletion,
    createdAt: profile.createdAt,
  };
}

export async function buildSelfProfileView(profileId: string) {
  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    include: {
      contact: true,
      education: true,
      profession: true,
      family: true,
      lifestyle: true,
      preference: true,
      photos: { select: { id: true, mimeType: true, isPrimary: true, createdAt: true } },
      pendingUpdate: { select: { submittedAt: true } },
    },
  });
  if (!profile) return null;

  return {
    profileCode: profile.profileCode,
    status: profile.status,
    verified: profile.verified,
    accountStatus: profile.accountStatus,
    profileCompletion: profile.profileCompletion,
    createdAt: profile.createdAt,
    personal: {
      fullName: profile.fullName,
      gender: profile.gender,
      dateOfBirth: profile.dateOfBirth,
      maritalStatus: profile.maritalStatus,
      heightCm: profile.heightCm,
      city: profile.city,
      area: profile.area,
      country: profile.country,
      nationality: profile.nationality,
      hasChildren: profile.hasChildren,
      numberOfChildren: profile.numberOfChildren,
    },
    contact: profile.contact,
    education: profile.education,
    profession: profile.profession,
    family: profile.family,
    lifestyle: profile.lifestyle,
    partnerPreference: profile.preference,
    photos: profile.photos,
    hasPendingUpdate: !!profile.pendingUpdate,
    pendingUpdateSubmittedAt: profile.pendingUpdate?.submittedAt ?? null,
  };
}

export type SelfProfileView = NonNullable<Awaited<ReturnType<typeof buildSelfProfileView>>>;

// Single source of truth for which AuditActions are safe to show the
// applicant who owns them — never staff-conduct/internal-only actions.
// Shared with /api/my-privacy/activity so the two screens never drift.
export const USER_SAFE_AUDIT_ACTIONS: AuditAction[] = [
  "CONTACT_VIEWED",
  "CONTACT_SHARED",
  "CONTACT_SHARE_REVOKED",
  "PROPOSAL_CREATED",
  "PROPOSAL_STATUS_CHANGED",
  "PROPOSAL_RESPONSE_SUBMITTED",
  "PROFILE_VERIFIED",
  "PROFILE_STATUS_CHANGED",
  "CONSENT_GRANTED",
  "CONSENT_REVOKED",
  "PHOTO_VIEWED",
  "PROFILE_SESSION_REVOKED",
  "UPDATE_REQUEST_SUBMITTED",
  "UPDATE_REQUEST_APPROVED",
  "UPDATE_REQUEST_REJECTED",
  // STEP 21 self-service actions
  "PHOTO_UPLOADED",
  "PHOTO_REPLACED",
  "PHOTO_DELETED",
  "PHOTO_SET_PRIMARY",
  "PARTNER_PREFERENCE_UPDATED",
  "LIFESTYLE_UPDATED",
  "CONTACT_PERMISSION_GRANTED_BY_APPLICANT",
  "CONTACT_PERMISSION_REVOKED_BY_APPLICANT",
  "MEETING_CONFIRMED_BY_APPLICANT",
  "MEETING_RESCHEDULE_REQUESTED_BY_APPLICANT",
  "MEETING_CANCELLED_BY_APPLICANT",
  "FAMILY_INTERACTION_REQUEST_SUBMITTED",
];

export interface ActivityItem {
  source: "audit" | "access";
  action: string;
  dataCategory: string | null;
  createdAt: Date;
}

export interface ActivityPage {
  items: ActivityItem[];
  total: number;
}

// Generalizes the merge that already happens ad hoc on /my-privacy's "My
// Activity" tab — adds pagination and an optional category filter (matched
// against a case-insensitive substring of the action name, e.g. "photo",
// "meeting", "proposal"). No new table: reads the same two existing
// sources (AuditLog + PrivacyAccessLog) this step's routes already write to.
export async function getActivityTimeline(profileId: string, opts: { page?: number; pageSize?: number; category?: string } = {}): Promise<ActivityPage> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));
  const category = opts.category?.trim().toLowerCase();

  const [auditEvents, accessEvents] = await Promise.all([
    prisma.auditLog.findMany({
      where: { targetProfileId: profileId, action: { in: USER_SAFE_AUDIT_ACTIONS } },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { action: true, createdAt: true },
    }),
    prisma.privacyAccessLog.findMany({
      where: { targetProfileId: profileId },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { action: true, dataCategory: true, createdAt: true },
    }),
  ]);

  let merged: ActivityItem[] = [
    ...auditEvents.map((e) => ({ source: "audit" as const, action: e.action, dataCategory: null, createdAt: e.createdAt })),
    ...accessEvents.map((e) => ({ source: "access" as const, action: e.action, dataCategory: e.dataCategory, createdAt: e.createdAt })),
  ];
  merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  if (category) {
    merged = merged.filter((i) => i.action.toLowerCase().includes(category));
  }

  const total = merged.length;
  const start = (page - 1) * pageSize;
  return { items: merged.slice(start, start + pageSize), total };
}
