import { prisma } from "@/lib/prisma";
import { computeProfileCompleteness } from "@/lib/verification/completeness";
import type { EngagementSnapshot } from "@/lib/engagement/types";

// STEP 30 — loads the EngagementSnapshot for ONE applicant from the existing tables (profile, verification, proposals,
// meetings, subscription, cases, preferences). Counts only: no contact details, documents, notes, risk signals or scores are
// read, so nothing built on the snapshot can expose them. Callers must already have authorised access to this profile.

const OPEN_CASE = ["NEW", "ACKNOWLEDGED", "ASSIGNED", "IN_REVIEW", "WAITING_FOR_USER", "WAITING_FOR_STAFF", "ESCALATED", "ACTION_REQUIRED", "REOPENED"] as const;

export async function loadEngagementSnapshot(profileId: string, now: Date = new Date()): Promise<EngagementSnapshot | null> {
  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    include: { contact: true, education: true, profession: true, family: true, lifestyle: true, preference: true, photos: { select: { id: true } }, verification: true },
  });
  if (!profile) return null;

  const mine = { OR: [{ profileAId: profileId }, { profileBId: profileId }] };
  const [proposalsTotal, awaitingA, awaitingB, bothReviewing, responses, meetings, membership, openCases, notifPref, state, crm, followupFeedback] = await Promise.all([
    prisma.proposal.count({ where: { ...mine, status: { notIn: ["DRAFT", "ARCHIVED"] } } }),
    prisma.proposal.count({ where: { profileAId: profileId, status: "WAITING_FOR_PROFILE_A" } }),
    prisma.proposal.count({ where: { profileBId: profileId, status: "WAITING_FOR_PROFILE_B" } }),
    prisma.proposal.count({ where: { ...mine, status: "BOTH_REVIEWING" } }),
    prisma.proposalResponse.count({ where: { profileId } }),
    prisma.meeting.findMany({ where: { proposal: mine }, select: { id: true, status: true, proposalId: true }, take: 200 }),
    prisma.subscription.findFirst({ where: { profileId }, orderBy: { createdAt: "desc" }, select: { status: true, endDate: true } }),
    prisma.case.count({ where: { reporterProfileId: profileId, status: { in: [...OPEN_CASE] } } }),
    prisma.notificationPreference.findUnique({ where: { profileId }, select: { id: true } }),
    prisma.engagementProfileState.findUnique({ where: { profileId }, select: { lastActivityAt: true } }),
    prisma.crmRecord.findUnique({ where: { profileId }, select: { lifecycleStage: true } }),
    prisma.engagementFeedback.findMany({ where: { profileId, type: "MEETING_FOLLOWUP" }, select: { refId: true }, take: 200 }),
  ]);

  const { categories } = computeProfileCompleteness({
    fullName: profile.fullName, gender: profile.gender, dateOfBirth: profile.dateOfBirth, maritalStatus: profile.maritalStatus, heightCm: profile.heightCm,
    city: profile.city, country: profile.country, nationality: profile.nationality, area: profile.area, contact: profile.contact,
    phoneVerified: !!profile.verification?.phoneVerifiedAt, emailVerified: !!profile.verification?.emailVerifiedAt, education: profile.education,
    profession: profile.profession, family: profile.family, lifestyle: profile.lifestyle, preference: profile.preference, hasPhoto: profile.photos.length > 0,
  });

  let requestedInfoCount = 0;
  try {
    const raw = profile.verification?.requestedInfoItems;
    const parsed = raw ? JSON.parse(raw) : [];
    requestedInfoCount = Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    requestedInfoCount = 0;
  }

  const awaiting = awaitingA + awaitingB + bothReviewing;
  const followedUp = new Set(followupFeedback.map((f) => f.refId));
  const completedMeetings = meetings.filter((m) => m.status === "COMPLETED");

  return {
    now,
    language: profile.preferredLanguage === "UR" ? "UR" : "EN",
    profile: { status: profile.status, verified: profile.verified, completion: profile.profileCompletion, createdAt: profile.createdAt, softDeleted: profile.softDeleted },
    missingSections: categories.filter((c) => c.missingFields.length > 0).map((c) => c.label),
    hasPhoto: profile.photos.length > 0,
    hasPartnerRequirements: !!profile.preference,
    verification: { status: profile.verification?.status ?? "NOT_VERIFIED", requestedInfoCount },
    proposals: { total: proposalsTotal, awaitingMyResponse: awaiting, responded: responses, received: proposalsTotal },
    meetings: {
      awaitingConfirmation: meetings.filter((m) => m.status === "REQUESTED").length,
      scheduled: meetings.filter((m) => m.status === "SCHEDULED" || m.status === "CONFIRMED" || m.status === "RESCHEDULED").length,
      completed: completedMeetings.length,
      completedAwaitingFollowup: completedMeetings.filter((m) => !followedUp.has(m.proposalId)).length,
    },
    membership: { status: membership?.status ?? null, endsAt: membership?.endDate ?? null },
    openCases,
    hasNotificationPreferences: !!notifPref,
    lastActivityAt: state?.lastActivityAt ?? null,
    crmStage: crm?.lifecycleStage ?? null,
    recentSupportInteractions: openCases,
    completedTasksRatio: null,
  };
}
