import { prisma } from "@/lib/prisma";
import { buildProposalDetailForProfile, projectMeetingSummary, type ProposalDetail } from "@/lib/visibility/proposal-visibility";
import { buildSelfProfileView } from "@/lib/visibility/user-data-visibility";
import { getFamilyMembership, hasFamilyPermission, getSharedRecord, isAccessExpired } from "@/lib/family/access-control";
import type { FamilyCommentTargetType, ProposalSharingLevel } from "@prisma/client";

// FamilyDataVisibilityService (STEP 22 plan Decision 6) — NEVER queries
// Proposal/Meeting/Profile data directly. It wraps STEP 21's existing
// applicant-facing visibility functions (the applicant's own full view) and
// narrows further by FamilySharedRecord.accessLevel — structurally
// impossible for a family member to see a field the applicant-facing
// service itself wouldn't return.

export async function getVisibleApplicantProfile(familyMemberId: string) {
  const membership = await getFamilyMembership(familyMemberId);
  if (!membership) return null;
  if (!(await hasFamilyPermission(familyMemberId, "profile.basic.view"))) return null;

  const full = await buildSelfProfileView(membership.applicantId);
  if (!full) return null;

  const [hasEdu, hasCareer, hasFamily, hasLifestyle, hasRequirements] = await Promise.all([
    hasFamilyPermission(familyMemberId, "profile.education.view"),
    hasFamilyPermission(familyMemberId, "profile.career.view"),
    hasFamilyPermission(familyMemberId, "profile.family.view"),
    hasFamilyPermission(familyMemberId, "profile.lifestyle.view"),
    hasFamilyPermission(familyMemberId, "profile.requirements.view"),
  ]);

  return {
    profileCode: full.profileCode,
    status: full.status,
    verified: full.verified,
    profileCompletion: full.profileCompletion,
    personal: full.personal,
    education: hasEdu ? full.education : null,
    profession: hasCareer ? full.profession : null,
    family: hasFamily ? full.family : null,
    lifestyle: hasLifestyle ? full.lifestyle : null,
    partnerPreference: hasRequirements ? full.partnerPreference : null,
    // contact/photos/documents are never included — see getVisibleContactData/getVisibleDocuments below.
  };
}

// Convenience wrapper over the same call (spec §53 lists it as its own
// method) — not a second code path.
export async function getVisibleFamilyData(familyMemberId: string) {
  const profile = await getVisibleApplicantProfile(familyMemberId);
  return profile?.family ?? null;
}

function narrowProposalBySharingLevel(detail: ProposalDetail, share: { accessLevel: ProposalSharingLevel; allowComments: boolean; allowResponse: boolean }) {
  const base = {
    proposalCode: detail.proposalCode,
    createdAt: detail.createdAt,
    status: detail.status,
    otherProfile: {
      fullName: detail.otherProfile.fullName,
      age: detail.otherProfile.age,
      city: detail.otherProfile.city,
      country: detail.otherProfile.country,
    },
    canComment: share.allowComments,
    canRespond: false,
  };
  if (share.accessLevel === "SUMMARY") return base;

  const standard = {
    ...base,
    otherProfile: { ...base.otherProfile, education: detail.otherProfile.education, profession: detail.otherProfile.profession, maritalStatus: detail.otherProfile.maritalStatus },
  };
  if (share.accessLevel === "STANDARD") return standard;

  const detailed = {
    ...standard,
    otherProfile: { ...standard.otherProfile, familyType: detail.otherProfile.familyType },
    compatibilityTier: detail.compatibilityTier,
    highlights: detail.highlights,
    differences: detail.differences,
  };
  if (share.accessLevel === "DETAILED") return detailed;

  // RESPONSE_PARTICIPATION
  return { ...detailed, canRespond: share.allowResponse, contactPermission: detail.contactPermission, meetings: detail.meetings };
}

// Returns null identically for "no such proposal," "not this applicant's
// proposal," "no FamilyPermission," and "never explicitly shared" — no
// enumeration signal, matching STEP 21's own proposal-detail precedent.
export async function getVisibleProposal(familyMemberId: string, proposalCode: string) {
  const membership = await getFamilyMembership(familyMemberId);
  if (!membership) return null;

  const proposal = await prisma.proposal.findUnique({
    where: { proposalCode: proposalCode.trim().toUpperCase() },
    select: { id: true, profileAId: true, profileBId: true },
  });
  if (!proposal) return null;
  if (proposal.profileAId !== membership.applicantId && proposal.profileBId !== membership.applicantId) return null;

  if (!(await hasFamilyPermission(familyMemberId, "proposal.view"))) return null;
  const share = await getSharedRecord(familyMemberId, "PROPOSAL", proposal.id);
  if (!share) return null;

  const detail = await buildProposalDetailForProfile(membership.applicantId, proposalCode);
  if (!detail) return null;

  return narrowProposalBySharingLevel(detail, share);
}

export async function getVisibleProposals(familyMemberId: string) {
  const membership = await getFamilyMembership(familyMemberId);
  if (!membership) return [];
  if (!(await hasFamilyPermission(familyMemberId, "proposal.view"))) return [];

  const shares = await prisma.familySharedRecord.findMany({ where: { familyMemberId, recordType: "PROPOSAL", status: "ACTIVE" } });
  const active = shares.filter((s) => !isAccessExpired(s));

  const results = await Promise.all(
    active.map(async (share) => {
      const proposal = await prisma.proposal.findUnique({ where: { id: share.recordId }, select: { proposalCode: true } });
      if (!proposal?.proposalCode) return null;
      const detail = await buildProposalDetailForProfile(membership.applicantId, proposal.proposalCode);
      return detail ? narrowProposalBySharingLevel(detail, share) : null;
    })
  );
  return results.filter((r): r is NonNullable<typeof r> => r !== null);
}

export async function getVisibleMeeting(familyMemberId: string, meetingId: string) {
  const membership = await getFamilyMembership(familyMemberId);
  if (!membership) return null;
  if (!(await hasFamilyPermission(familyMemberId, "meeting.view"))) return null;

  const share = await getSharedRecord(familyMemberId, "MEETING", meetingId);
  if (!share) return null;

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { id: true, meetingType: true, scheduledAt: true, locationInfo: true, participants: true, status: true, proposalId: true },
  });
  if (!meeting) return null;
  const proposal = await prisma.proposal.findUnique({ where: { id: meeting.proposalId }, select: { profileAId: true, profileBId: true } });
  if (!proposal || (proposal.profileAId !== membership.applicantId && proposal.profileBId !== membership.applicantId)) return null;

  return projectMeetingSummary(meeting);
}

export async function getVisibleMeetings(familyMemberId: string) {
  const membership = await getFamilyMembership(familyMemberId);
  if (!membership) return [];
  if (!(await hasFamilyPermission(familyMemberId, "meeting.view"))) return [];

  const shares = await prisma.familySharedRecord.findMany({ where: { familyMemberId, recordType: "MEETING", status: "ACTIVE" } });
  const active = shares.filter((s) => !isAccessExpired(s));
  const meetings = await prisma.meeting.findMany({ where: { id: { in: active.map((s) => s.recordId) } } });
  return meetings.map(projectMeetingSummary);
}

// FamilyComment visibility (spec §23/§53's getVisibleCommunication) — never
// exposes ADMIN_SHARED-only content or another member's APPLICANT_ONLY note.
export async function getVisibleCommunication(familyMemberId: string, targetType: FamilyCommentTargetType, targetId: string) {
  const membership = await getFamilyMembership(familyMemberId);
  if (!membership) return [];

  const comments = await prisma.familyComment.findMany({ where: { targetType, targetId }, orderBy: { createdAt: "asc" } });
  return comments
    .filter((c) => c.visibility === "FAMILY_SHARED" || c.familyMemberId === familyMemberId)
    .map((c) => ({ id: c.id, commentType: c.commentType, body: c.body, createdAt: c.createdAt, mine: c.familyMemberId === familyMemberId }));
}

// Decision 9 — contact info and documents are never included in any family
// visibility path in this pass. Named per spec §53 so the method surface is
// complete, but both always deny: contact info stays behind the existing
// STEP 13 contact-sharing workflow; document sharing is not yet enabled.
export function getVisibleContactData(): null {
  return null;
}

export function getVisibleDocuments(): [] {
  return [];
}
