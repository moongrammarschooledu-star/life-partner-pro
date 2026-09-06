import { sendNotification, notifyAdmins } from "@/lib/notifications/notification-service";
import { createTask } from "@/lib/admin-tasks";
import type { NotificationType, ProposalResponseType, MeetingStatus } from "@prisma/client";

// One named wrapper per spec §18 reusable event — lifecycle-transition
// routes call these, never sendNotification()/notifyAdmins() directly, so
// the event catalog stays a real, reviewable list rather than scattered
// inline calls.

export async function notifyProfileRegistered(profileId: string) {
  await sendNotification({ profileId, type: "ACCOUNT_REGISTERED", data: {} });
}

export async function notifyProfileSubmitted(profileId: string) {
  await sendNotification({ profileId, type: "PROFILE_SUBMITTED", data: {} });
}

export async function notifyProfileVerificationChanged(
  profileId: string,
  type: Extract<NotificationType, "VERIFICATION_APPROVED" | "VERIFICATION_ACTION_REQUIRED" | "VERIFICATION_REJECTED" | "RE_VERIFICATION_REQUIRED">
) {
  await sendNotification({ profileId, type, data: {} });
}

export async function notifyProfileSuspended(profileId: string) {
  await sendNotification({ profileId, type: "ACCOUNT_SUSPENDED", data: {} });
}

export async function notifyProfileApproved(profileId: string) {
  await sendNotification({ profileId, type: "PROFILE_APPROVED", data: {} });
}

export async function notifyProfileUpdateDecision(profileId: string, approved: boolean) {
  await sendNotification({ profileId, type: approved ? "PROFILE_UPDATE_APPROVED" : "PROFILE_UPDATE_REJECTED", data: {} });
}

export async function notifyAdminProfileUpdatePending(profileId: string) {
  await Promise.all([
    notifyAdmins({ type: "ADMIN_PROFILE_UPDATE_PENDING", data: { relatedProfileId: profileId } }),
    createTask({ taskType: "NEW_PROFILE_REVIEW", resourceType: "PROFILE", resourceId: profileId }),
  ]);
}

export async function notifyMatchIdentified(profileId: string) {
  await sendNotification({ profileId, type: "MATCH_IDENTIFIED", data: {} });
}

export async function notifyProposalCreated(proposal: { id: string; profileAId: string; profileBId: string }) {
  await Promise.all([
    sendNotification({ profileId: proposal.profileAId, type: "PROPOSAL_RECEIVED", data: { relatedProposalId: proposal.id } }),
    sendNotification({ profileId: proposal.profileBId, type: "PROPOSAL_RECEIVED", data: { relatedProposalId: proposal.id } }),
  ]);
}

export async function notifyProposalResponseReceived(params: {
  proposalId: string;
  profileAId: string;
  profileBId: string;
  responderId: string;
  response: ProposalResponseType;
  newStatus: string;
  assignedToId: string | null;
}) {
  const otherProfileId = params.responderId === params.profileAId ? params.profileBId : params.profileAId;

  if (params.newStatus === "BOTH_INTERESTED") {
    await Promise.all([
      sendNotification({ profileId: params.profileAId, type: "PROPOSAL_MUTUAL_INTEREST", data: { relatedProposalId: params.proposalId } }),
      sendNotification({ profileId: params.profileBId, type: "PROPOSAL_MUTUAL_INTEREST", data: { relatedProposalId: params.proposalId } }),
      notifyAdmins({ type: "ADMIN_MUTUAL_INTEREST", data: { relatedProposalId: params.proposalId }, assignedAdminId: params.assignedToId }),
      createTask({
        assignedToId: params.assignedToId,
        taskType: "PROPOSAL_FOLLOWUP",
        resourceType: "PROPOSAL",
        resourceId: params.proposalId,
        priority: "HIGH",
      }),
    ]);
    return;
  }

  const type = params.response === "NOT_INTERESTED" ? "PROPOSAL_NOT_INTERESTED" : "PROPOSAL_STATUS_CHANGED";
  await sendNotification({ profileId: otherProfileId, type, data: { relatedProposalId: params.proposalId } });
}

export async function notifyContactPermissionAction(profileId: string, proposalId: string, action: "request" | "approve" | "revoke") {
  const type = action === "request" ? "CONTACT_PERMISSION_REQUESTED" : action === "approve" ? "CONTACT_PERMISSION_APPROVED" : "CONTACT_PERMISSION_REVOKED";
  await sendNotification({ profileId, type, data: { relatedProposalId: proposalId } });
}

export async function notifyAdminContactPermissionRequest(proposalId: string, assignedToId: string | null) {
  await Promise.all([
    notifyAdmins({ type: "ADMIN_CONTACT_PERMISSION_REQUEST", data: { relatedProposalId: proposalId }, assignedAdminId: assignedToId }),
    createTask({ assignedToId, taskType: "CONTACT_REQUEST_TASK", resourceType: "PROPOSAL", resourceId: proposalId }),
  ]);
}

export async function notifyContactApproved(profileAId: string, profileBId: string, proposalId: string) {
  await Promise.all([
    sendNotification({ profileId: profileAId, type: "PROPOSAL_STATUS_CHANGED", data: { relatedProposalId: proposalId } }),
    sendNotification({ profileId: profileBId, type: "PROPOSAL_STATUS_CHANGED", data: { relatedProposalId: proposalId } }),
  ]);
}

export async function notifyMeetingScheduled(profileAId: string, profileBId: string, proposalId: string) {
  await Promise.all([
    sendNotification({ profileId: profileAId, type: "MEETING_SCHEDULED", data: { relatedProposalId: proposalId } }),
    sendNotification({ profileId: profileBId, type: "MEETING_SCHEDULED", data: { relatedProposalId: proposalId } }),
  ]);
}

const MEETING_STATUS_TYPE: Partial<Record<MeetingStatus, NotificationType>> = {
  CONFIRMED: "MEETING_CONFIRMED",
  RESCHEDULED: "MEETING_RESCHEDULED",
  CANCELLED: "MEETING_CANCELLED",
  COMPLETED: "MEETING_COMPLETED",
};

export async function notifyMeetingUpdated(profileAId: string, profileBId: string, proposalId: string, newStatus: MeetingStatus, assignedToId: string | null) {
  const type = MEETING_STATUS_TYPE[newStatus];
  if (!type) return;
  await Promise.all([
    sendNotification({ profileId: profileAId, type, data: { relatedProposalId: proposalId } }),
    sendNotification({ profileId: profileBId, type, data: { relatedProposalId: proposalId } }),
    newStatus === "CONFIRMED"
      ? Promise.all([
          notifyAdmins({ type: "ADMIN_MEETING_CONFIRMATION", data: { relatedProposalId: proposalId }, assignedAdminId: assignedToId }),
          createTask({ assignedToId, taskType: "MEETING_TASK", resourceType: "PROPOSAL", resourceId: proposalId }),
        ])
      : Promise.resolve(),
  ]);
}

export async function notifyProposalAssigned(proposalId: string, assignedToId: string | null) {
  if (!assignedToId) return;
  await notifyAdmins({ type: "ADMIN_ASSIGNMENT_CHANGED", data: { relatedProposalId: proposalId }, assignedAdminId: assignedToId });
}

export async function notifyVerificationAssigned(profileId: string, assignedToId: string | null) {
  if (!assignedToId) return;
  await notifyAdmins({ type: "ADMIN_ASSIGNMENT_CHANGED", data: { relatedProfileId: profileId }, assignedAdminId: assignedToId });
}

export async function notifySecurityFlagAssigned(profileId: string, assignedToId: string | null) {
  if (!assignedToId) return;
  await notifyAdmins({ type: "ADMIN_ASSIGNMENT_CHANGED", data: { relatedProfileId: profileId }, assignedAdminId: assignedToId });
}

export async function notifyProposalStatusChanged(proposal: { id: string; profileAId: string; profileBId: string }, newStatus: string) {
  const type = newStatus === "FINALIZED" ? "PROPOSAL_FINALIZED" : "PROPOSAL_STATUS_CHANGED";
  await Promise.all([
    sendNotification({ profileId: proposal.profileAId, type, data: { relatedProposalId: proposal.id } }),
    sendNotification({ profileId: proposal.profileBId, type, data: { relatedProposalId: proposal.id } }),
  ]);
}

export async function notifySecurityFlagRaised(profileId: string, isDuplicate: boolean, flagId?: string) {
  await Promise.all([
    notifyAdmins({
      type: isDuplicate ? "ADMIN_DUPLICATE_PROFILE_ALERT" : "ADMIN_SUSPICIOUS_ACTIVITY",
      data: { relatedProfileId: profileId },
    }),
    flagId ? createTask({ taskType: "VERIFICATION_REQUEST", resourceType: "SECURITY_FLAG", resourceId: flagId, priority: "HIGH" }) : Promise.resolve(),
  ]);
}

// One summary notification per scan run, rather than one per flag, so a scan
// that finds many duplicates at once doesn't spam the admin inbox.
export async function notifyDuplicateScanSummary(flagsCreated: number) {
  if (flagsCreated <= 0) return;
  await notifyAdmins({ type: "ADMIN_DUPLICATE_PROFILE_ALERT", data: {} });
}

export async function notifyOverdueFollowUp(profileId: string, followUpId: string, assignedToId?: string | null) {
  await Promise.all([
    notifyAdmins({ type: "ADMIN_OVERDUE_FOLLOWUP", data: { relatedProfileId: profileId, templateVars: { profile_id: followUpId } } }),
    createTask({ assignedToId, taskType: "FOLLOW_UP_DUE", resourceType: "FOLLOW_UP", resourceId: followUpId, priority: "HIGH" }),
  ]);
}

export async function notifyFollowupReminder(profileId: string) {
  await sendNotification({ profileId, type: "FOLLOWUP_REMINDER", data: {} });
}

export async function notifyProposalPendingReminder(proposal: { id: string; profileAId: string; profileBId: string }) {
  await Promise.all([
    sendNotification({ profileId: proposal.profileAId, type: "PROPOSAL_PENDING_REMINDER", data: { relatedProposalId: proposal.id } }),
    sendNotification({ profileId: proposal.profileBId, type: "PROPOSAL_PENDING_REMINDER", data: { relatedProposalId: proposal.id } }),
  ]);
}

export async function notifyMeetingReminder(profileAId: string, profileBId: string, proposalId: string, window: "24H" | "2H") {
  const type = window === "24H" ? "MEETING_REMINDER_24H" : "MEETING_REMINDER_2H";
  await Promise.all([
    sendNotification({ profileId: profileAId, type, data: { relatedProposalId: proposalId } }),
    sendNotification({ profileId: profileBId, type, data: { relatedProposalId: proposalId } }),
  ]);
}
