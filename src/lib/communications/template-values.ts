import { prisma } from "@/lib/prisma";
import type { COMMUNICATION_VARIABLE_KEYS } from "@/lib/communications/template-values-types";

// Server-side construction of template variable VALUES. This is the ONLY place values come from: a template can never name a
// database field, and a request can never supply a value. Only the whitelisted variables (secure-renderer.ts) exist here, and only
// data the RECIPIENT is already entitled to see about themselves (their own first name, their own profile code, the proposal /
// meeting / case they are a party to). Nothing about another person, no contact detail, no notes, no risk data.

export type TemplateValueKey = (typeof COMMUNICATION_VARIABLE_KEYS)[number];

const VERIFICATION_LABEL: Record<string, string> = {
  NOT_VERIFIED: "not yet verified",
  VERIFICATION_PENDING: "verification pending",
  UNDER_REVIEW: "under review",
  VERIFICATION_REQUIRED: "verification required",
  VERIFIED: "verified",
  VERIFICATION_REJECTED: "needs attention",
  VERIFICATION_EXPIRED: "expired",
  RE_VERIFICATION_REQUIRED: "re-verification required",
};

const APPLICATION_LABEL: Record<string, string> = {
  NEW: "received",
  UNDER_REVIEW: "under review",
  VERIFIED: "verified",
  ACTIVE: "active",
  MATCHING: "active",
  SUSPENDED: "on hold",
  REJECTED: "not approved",
  ARCHIVED: "archived",
};

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? "";
}

export interface ValueContext {
  proposalId?: string | null;
  meetingId?: string | null;
  caseId?: string | null;
}

export async function buildTemplateValues(profileId: string, ctx: ValueContext = {}): Promise<Partial<Record<TemplateValueKey, string>>> {
  const profile = await prisma.profile.findUnique({ where: { id: profileId }, select: { fullName: true, profileCode: true, status: true, verification: { select: { status: true } } } });
  if (!profile) return {};
  const values: Partial<Record<TemplateValueKey, string>> = {
    firstName: firstName(profile.fullName),
    profileId: profile.profileCode,
    verificationStatus: VERIFICATION_LABEL[profile.verification?.status ?? "NOT_VERIFIED"] ?? "pending",
    applicationStatus: APPLICATION_LABEL[profile.status] ?? "received",
  };

  if (ctx.proposalId) {
    // Only a proposal this profile is actually a party to.
    const proposal = await prisma.proposal.findFirst({ where: { id: ctx.proposalId, OR: [{ profileAId: profileId }, { profileBId: profileId }] }, select: { proposalCode: true } });
    if (proposal?.proposalCode) values.proposalId = proposal.proposalCode;
  }
  if (ctx.meetingId) {
    const meeting = await prisma.meeting.findFirst({ where: { id: ctx.meetingId, proposal: { OR: [{ profileAId: profileId }, { profileBId: profileId }] } }, select: { scheduledAt: true } });
    if (meeting) {
      values.meetingDate = meeting.scheduledAt.toISOString().slice(0, 10);
      values.meetingTime = meeting.scheduledAt.toISOString().slice(11, 16) + " UTC";
    }
  }
  if (ctx.caseId) {
    const c = await prisma.case.findFirst({ where: { id: ctx.caseId, reporterProfileId: profileId }, select: { caseNumber: true } });
    if (c) values.supportCaseId = c.caseNumber;
  }
  return values;
}
