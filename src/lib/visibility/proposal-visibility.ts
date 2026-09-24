import { prisma } from "@/lib/prisma";
import { ensureProposalCode } from "@/lib/proposal-code";
import { APPLICANT_STATUS_LABEL } from "@/lib/proposal-status-labels";
import { deriveApplicantHighlights } from "@/lib/proposal-workflow";
import { calculateAge } from "@/lib/utils";
import { thresholdsFromSettings, DEFAULT_THRESHOLDS, type MatchThresholds } from "@/lib/matching";
import type {
  Profile,
  EducationInfo,
  ProfessionInfo,
  FamilyInfo,
  MaritalStatus,
  ProposalResponseType,
  MeetingType,
  MeetingStatus,
} from "@prisma/client";

// STEP 21 — ProposalVisibilityService. Extracted, generalized version of the
// narrow "self, safely projected" logic that already lived inline in
// /api/my-proposals/route.ts (the field list below is frozen from that
// route's exact prior shape — see proposal-visibility.snapshot.test.ts).
// Deliberately never includes: contact info, admin notes, internal
// rejection notes, staff identity, raw per-category numeric scores, or the
// other profile's photos (spec §5/§26).

type OtherPartySource = Pick<Profile, "fullName" | "profileCode" | "dateOfBirth" | "city" | "country" | "maritalStatus"> & {
  education: Pick<EducationInfo, "level"> | null;
  profession: Pick<ProfessionInfo, "profession"> | null;
  family: Pick<FamilyInfo, "familyType"> | null;
};

export interface OtherPartyView {
  fullName: string;
  profileCode: string;
  age: number;
  city: string;
  country: string;
  education: string | null;
  profession: string | null;
  maritalStatus: MaritalStatus;
  familyType: string | null;
}

export function projectOtherParty(other: OtherPartySource): OtherPartyView {
  return {
    fullName: other.fullName,
    profileCode: other.profileCode,
    age: calculateAge(other.dateOfBirth),
    city: other.city,
    country: other.country,
    education: other.education?.level ?? null,
    profession: other.profession?.profession ?? null,
    maritalStatus: other.maritalStatus,
    familyType: other.family?.familyType ?? null,
  };
}

function tierLabelFor(total: number, thresholds: MatchThresholds): string {
  if (total >= thresholds.excellent) return "Excellent Match";
  if (total >= thresholds.veryGood) return "Very Good Match";
  if (total >= thresholds.good) return "Good Match";
  if (total >= thresholds.possible) return "Possible Match";
  return "Low Compatibility";
}

async function loadThresholds(): Promise<MatchThresholds> {
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  return settings ? thresholdsFromSettings(settings) : DEFAULT_THRESHOLDS;
}

export interface ProposalListItem {
  proposalCode: string;
  createdAt: Date;
  status: string;
  compatibilityScore: number | null;
  compatibilityTier: string | null;
  myResponse: ProposalResponseType | null;
  otherProfile: OtherPartyView;
  highlights: string[];
  differences: string[];
}

const PROPOSAL_LIST_INCLUDE = {
  profileA: { include: { education: true, profession: true, family: true } },
  profileB: { include: { education: true, profession: true, family: true } },
  match: true,
} as const;

function toListItem(
  p: { profileAId: string; profileBId: string; profileA: OtherPartySource; profileB: OtherPartySource; matchScore: number | null; status: keyof typeof APPLICANT_STATUS_LABEL; createdAt: Date; id: string; proposalCode: string | null; match: { breakdown: string } | null },
  profileId: string,
  myResponse: ProposalResponseType | null,
  thresholds: MatchThresholds,
  proposalCode: string
): ProposalListItem {
  const isA = p.profileAId === profileId;
  const other = isA ? p.profileB : p.profileA;
  const breakdown = p.match ? (JSON.parse(p.match.breakdown) as { category: string; status: "compatible" | "partial" | "incompatible" | "unknown" }[]) : [];
  const { highlights, differences } = deriveApplicantHighlights(breakdown as never);

  return {
    proposalCode,
    createdAt: p.createdAt,
    status: APPLICANT_STATUS_LABEL[p.status],
    compatibilityScore: p.matchScore,
    compatibilityTier: p.matchScore != null ? tierLabelFor(p.matchScore, thresholds) : null,
    myResponse,
    otherProfile: projectOtherParty(other),
    highlights,
    differences,
  };
}

export async function buildProposalListForProfile(profileId: string): Promise<ProposalListItem[]> {
  const thresholds = await loadThresholds();

  const proposals = await prisma.proposal.findMany({
    where: { OR: [{ profileAId: profileId }, { profileBId: profileId }] },
    include: { ...PROPOSAL_LIST_INCLUDE, responses: { where: { profileId } } },
    orderBy: { createdAt: "desc" },
  });

  return Promise.all(
    proposals.map(async (p) => {
      const code = await ensureProposalCode(p);
      const myResponse = p.responses[0]?.response ?? null;
      return toListItem(p, profileId, myResponse, thresholds, code);
    })
  );
}

export interface MeetingSummary {
  id: string;
  meetingType: MeetingType;
  scheduledAt: Date;
  locationInfo: string | null;
  participants: string | null;
  status: MeetingStatus;
}

// Never includes Meeting.notes (free-text, may carry internal/admin
// commentary) — mirrors the "never admin notes" discipline applied to
// FamilyCommunication elsewhere in this step.
export function projectMeetingSummary(m: { id: string; meetingType: MeetingType; scheduledAt: Date; locationInfo: string | null; participants: string | null; status: MeetingStatus }): MeetingSummary {
  return {
    id: m.id,
    meetingType: m.meetingType,
    scheduledAt: m.scheduledAt,
    locationInfo: m.locationInfo,
    participants: m.participants,
    status: m.status,
  };
}

export interface ProposalDetail extends ProposalListItem {
  events: { status: string; createdAt: Date }[];
  contactPermission: { mine: boolean; theirs: boolean };
  meetings: MeetingSummary[];
}

// Returns null identically for "no such proposal" and "proposal exists but
// caller isn't part of it" — no enumeration signal (spec §4/§52).
export async function buildProposalDetailForProfile(profileId: string, proposalCode: string): Promise<ProposalDetail | null> {
  const proposal = await prisma.proposal.findUnique({
    where: { proposalCode: proposalCode.trim().toUpperCase() },
    include: {
      ...PROPOSAL_LIST_INCLUDE,
      responses: true,
      events: { orderBy: { createdAt: "asc" } },
      contactPermissions: true,
      meetings: { orderBy: { scheduledAt: "asc" } },
    },
  });
  if (!proposal || (proposal.profileAId !== profileId && proposal.profileBId !== profileId)) return null;

  const otherProfileId = proposal.profileAId === profileId ? proposal.profileBId : proposal.profileAId;
  const myResponse = proposal.responses.find((r) => r.profileId === profileId)?.response ?? null;
  const thresholds = await loadThresholds();
  const code = await ensureProposalCode(proposal);
  const listItem = toListItem(proposal, profileId, myResponse, thresholds, code);

  const isApproved = (pid: string) => proposal.contactPermissions.some((p) => p.profileId === pid && p.approvedAt && !p.revokedAt);

  return {
    ...listItem,
    events: proposal.events.map((e) => ({ status: APPLICANT_STATUS_LABEL[e.status], createdAt: e.createdAt })),
    contactPermission: { mine: isApproved(profileId), theirs: isApproved(otherProfileId) },
    meetings: proposal.meetings.map(projectMeetingSummary),
  };
}
