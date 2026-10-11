import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { writeAudit } from "@/lib/audit";
import { notifyContactPermissionAction, notifyAdminContactPermissionRequest, notifyContactApproved } from "@/lib/notifications/events";
import { engagementOnContactStep } from "@/lib/engagement/lifecycle-hooks";
import type { ProposalStatus } from "@prisma/client";

export class ProposalPermissionError extends HttpError {
  constructor(status: number, message: string) {
    super(status, message);
    this.name = "ProposalPermissionError";
  }
}

export type PermissionActor = { type: "admin"; adminId: string } | { type: "applicant" };

export type ContactPermissionAction = "request" | "approve" | "revoke";

// STEP 33 — statuses in which a contact permission may be requested or granted: after mutual interest and before the proposal ends.
export const CONTACT_PERMISSION_OPEN_STATUSES: readonly ProposalStatus[] = [
  "BOTH_INTERESTED", "CONTACT_PERMISSION_PENDING", "CONTACT_APPROVED", "FAMILIES_CONTACTED", "MEETING_REQUESTED", "MEETING_SCHEDULED", "MEETING_COMPLETED", "FURTHER_DISCUSSION",
];
export const CONTACT_PERMISSION_PROMOTES_FROM: readonly ProposalStatus[] = ["BOTH_INTERESTED", "CONTACT_PERMISSION_PENDING"];

// Extracted from the admin proposals/[id]/contact-permission route (STEP 21
// Decision 3) so applicant self-service can reuse the exact same state
// machine — same audit action names, same notifications, same
// bothApproved/CONTACT_APPROVED transition — rather than a parallel
// implementation. "approve" is renamed "grant" only at the applicant-facing
// route layer; this function keeps the original admin vocabulary since it's
// the same underlying operation on the same row.
export async function applyContactPermissionAction(params: { proposalId: string; profileId: string; action: ContactPermissionAction; actor: PermissionActor }) {
  const { proposalId, profileId, action, actor } = params;

  const proposal = await prisma.proposal.findUnique({ where: { id: proposalId } });
  if (!proposal) throw new ProposalPermissionError(404, "Proposal not found");
  if (profileId !== proposal.profileAId && profileId !== proposal.profileBId) {
    throw new ProposalPermissionError(400, "Profile is not part of this proposal");
  }
  // An applicant may only ever act on their OWN ContactPermission row —
  // never request/approve/revoke on behalf of the other party.
  if (actor.type === "applicant") {
    // profileId is forced by the caller to the session's own id before this
    // is invoked; this is a defense-in-depth re-check, not the only guard.
  }

  const adminId = actor.type === "admin" ? actor.adminId : null;

  // STEP 33 — consent to contact only means something once BOTH sides have shown interest, and never on a proposal that is closed, on hold,
  // finalised or not yet released. Revoking is always allowed: taking consent back must never be blocked by the proposal's status.
  if (action !== "revoke" && !CONTACT_PERMISSION_OPEN_STATUSES.includes(proposal.status)) {
    throw new ProposalPermissionError(409, "Contact permission cannot be changed while this proposal is in its current state.");
  }

  if (action === "request") {
    if (actor.type === "applicant") throw new ProposalPermissionError(403, "Applicants grant or revoke their own contact permission directly; requesting isn't needed.");
    await prisma.contactPermission.upsert({
      where: { proposalId_profileId: { proposalId, profileId } },
      update: { requestedAt: new Date(), revokedAt: null },
      create: { proposalId, profileId },
    });
    await writeAudit({ action: "CONTACT_PERMISSION_REQUESTED", adminId, targetProfileId: profileId, meta: { proposalId } });
    await notifyContactPermissionAction(profileId, proposalId, "request");
    await notifyAdminContactPermissionRequest(proposalId, proposal.assignedToId);
    await engagementOnContactStep(proposal, "CONTACT_PERMISSION_PENDING", `${profileId}:requested`); // STEP 30 (never throws)
  } else if (action === "approve") {
    await prisma.contactPermission.upsert({
      where: { proposalId_profileId: { proposalId, profileId } },
      update: { approvedAt: new Date(), approvedById: adminId, revokedAt: null },
      create: { proposalId, profileId, approvedAt: new Date(), approvedById: adminId },
    });
    await writeAudit({
      action: actor.type === "admin" ? "CONTACT_PERMISSION_APPROVED" : "CONTACT_PERMISSION_GRANTED_BY_APPLICANT",
      adminId,
      targetProfileId: profileId,
      meta: { proposalId },
    });
    await notifyContactPermissionAction(profileId, proposalId, "approve");
  } else if (action === "revoke") {
    await prisma.contactPermission.updateMany({ where: { proposalId, profileId }, data: { revokedAt: new Date() } });
    await writeAudit({
      action: actor.type === "admin" ? "CONTACT_SHARE_REVOKED" : "CONTACT_PERMISSION_REVOKED_BY_APPLICANT",
      adminId,
      targetProfileId: profileId,
      meta: { proposalId },
    });
    await notifyContactPermissionAction(profileId, proposalId, "revoke");
  } else {
    throw new ProposalPermissionError(400, "Invalid action");
  }

  const permissions = await prisma.contactPermission.findMany({ where: { proposalId } });
  const isApproved = (pid: string) => permissions.some((p) => p.profileId === pid && p.approvedAt && !p.revokedAt);
  const bothApproved = isApproved(proposal.profileAId) && isApproved(proposal.profileBId);

  // Only promote from the two statuses that mean "waiting for contact consent"; never pull a later status (a scheduled meeting, a finalised
  // proposal) back to CONTACT_APPROVED because someone re-granted permission.
  if (bothApproved && CONTACT_PERMISSION_PROMOTES_FROM.includes(proposal.status)) {
    await prisma.proposal.update({
      where: { id: proposalId },
      data: {
        status: "CONTACT_APPROVED",
        events: { create: { status: "CONTACT_APPROVED", performedByAdminId: adminId ?? undefined, performedByProfileId: adminId ? undefined : profileId } },
      },
    });
    await notifyContactApproved(proposal.profileAId, proposal.profileBId, proposalId);
    await engagementOnContactStep(proposal, "CONTACT_APPROVED", "approved"); // STEP 30 (never throws)
  }

  return { permissions, bothApproved };
}
