import { tapEngagement } from "@/lib/engagement/tap";
import type { ProfileStatus, VerificationStatus } from "@prisma/client";

// STEP 30 - named hooks the existing modules call at the moment something happens. Each one only RECORDS an engagement event
// (idempotent, flag-gated, never throws, never changes the caller's result) and, where the spec asks for it, closes a small
// gap in an earlier step in the same additive way. Nothing in here sends a message.

export async function engagementOnRegistered(profileId: string, opts: { referralCode?: unknown; completion?: number } = {}): Promise<void> {
  try {
    // STEP 28 gap: self-registered applicants had no CRM record until someone created one by hand.
    const { createCrmRecord } = await import("@/lib/crm/crm-record-service");
    await createCrmRecord(profileId);
  } catch (error) {
    console.error("[engagement] crm record on registration failed", error instanceof Error ? error.message : "error");
  }
  await tapEngagement({ profileId, type: "USER_REGISTERED" });
  await tapEngagement({ profileId, type: "PROFILE_STARTED" });
  if ((opts.completion ?? 0) >= 100) await tapEngagement({ profileId, type: "PROFILE_COMPLETED" });
  if (opts.referralCode !== undefined) {
    const { captureRegistrationReferral } = await import("@/lib/engagement/referral-extension");
    await captureRegistrationReferral(profileId, opts.referralCode);
  }
}

export async function engagementOnProfileStatus(profileId: string, status: ProfileStatus): Promise<void> {
  try {
    // STEP 28 gap: profile status changes did not move the CRM stage (only suspension did). This helper silently no-ops on
    // anything the lifecycle guard would reject.
    const { syncCrmStageFromProfileStatus } = await import("@/lib/crm/profile-status-sync");
    await syncCrmStageFromProfileStatus(profileId, status);
  } catch (error) {
    console.error("[engagement] crm sync failed", error instanceof Error ? error.message : "error");
  }
  if (status === "UNDER_REVIEW") await tapEngagement({ profileId, type: "PROFILE_SUBMITTED" });
  if (status === "ACTIVE") await tapEngagement({ profileId, type: "PROFILE_ACTIVATED" });
}

export async function engagementOnVerification(profileId: string, status: VerificationStatus): Promise<void> {
  if (status === "UNDER_REVIEW" || status === "VERIFICATION_PENDING") await tapEngagement({ profileId, type: "VERIFICATION_STARTED" });
  if (status === "VERIFICATION_REQUIRED") await tapEngagement({ profileId, type: "PROFILE_UPDATE_REQUESTED", sourceKey: `verification:${new Date().toISOString().slice(0, 10)}` });
  if (status === "VERIFIED") {
    await tapEngagement({ profileId, type: "VERIFICATION_COMPLETED" });
    const { processReferralQualifyingEvent } = await import("@/lib/engagement/referral-extension");
    await processReferralQualifyingEvent(profileId, "VERIFICATION_COMPLETE");
  }
}

export async function engagementOnCompleteness(profileId: string, percent: number): Promise<void> {
  if (percent >= 100) await tapEngagement({ profileId, type: "PROFILE_COMPLETED" });
}

// A proposal-scoped event for BOTH sides. The proposal id is the reference (so a reminder tied to it is settled by the same
// reference) and the source key keeps repeat updates of the same thing from creating duplicate events.
export async function engagementOnProposalPair(
  proposal: { id: string; profileAId: string; profileBId: string },
  type: Parameters<typeof tapEngagement>[0]["type"],
  sourceKey: string,
): Promise<void> {
  for (const profileId of [proposal.profileAId, proposal.profileBId]) {
    await tapEngagement({ profileId, type, sourceKey: `${proposal.id}:${sourceKey}`, refType: "PROPOSAL", refId: proposal.id });
  }
}

export async function engagementOnProposalResponse(profileId: string, proposal: { id: string; profileAId: string; profileBId: string }, newStatus: string): Promise<void> {
  await tapEngagement({ profileId, type: "PROPOSAL_RESPONSE_RECEIVED", sourceKey: `${proposal.id}:resp`, refType: "PROPOSAL", refId: proposal.id });
  if (newStatus === "BOTH_INTERESTED") await engagementOnProposalPair(proposal, "MUTUAL_INTEREST", "mutual");
}

export async function engagementOnContactStep(proposal: { id: string; profileAId: string; profileBId: string }, type: "CONTACT_PERMISSION_PENDING" | "CONTACT_APPROVED", sourceKey: string): Promise<void> {
  await engagementOnProposalPair(proposal, type, sourceKey);
}

export async function engagementOnMeeting(
  proposal: { id: string; profileAId: string; profileBId: string },
  meetingId: string,
  status: "REQUESTED" | "SCHEDULED" | "CONFIRMED" | "COMPLETED" | "RESCHEDULED" | "CANCELLED",
): Promise<void> {
  if (status === "REQUESTED") await engagementOnProposalPair(proposal, "MEETING_REQUESTED", `m:${meetingId}`);
  else if (status === "SCHEDULED" || status === "CONFIRMED") await engagementOnProposalPair(proposal, "MEETING_SCHEDULED", `m:${meetingId}`);
  else if (status === "COMPLETED") {
    await engagementOnProposalPair(proposal, "MEETING_COMPLETED", `m:${meetingId}`);
    await engagementOnProposalPair(proposal, "FOLLOWUP_DUE", `m:${meetingId}`); // a completed meeting means the follow-up step is now due
  }
}

export async function engagementOnSupportCase(profileId: string, caseId: string): Promise<void> {
  await tapEngagement({ profileId, type: "SUPPORT_CASE_CREATED", sourceKey: caseId, refType: "CASE", refId: caseId });
}

export async function engagementOnLogin(profileId: string): Promise<void> {
  await tapEngagement({ profileId, type: "LOGIN" });
}

export async function engagementOnMembershipStarted(profileId: string, subscriptionId: string): Promise<void> {
  await tapEngagement({ profileId, type: "MEMBERSHIP_STARTED", sourceKey: subscriptionId, refType: "SUBSCRIPTION", refId: subscriptionId });
}
