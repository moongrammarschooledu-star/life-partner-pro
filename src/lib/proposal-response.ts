import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { nextProposalStatus } from "@/lib/proposal-workflow";
import { writeAudit } from "@/lib/audit";
import { notifyProposalResponseReceived } from "@/lib/notifications/events";
import type { ProposalResponseType, ProposalDeclineReason } from "@prisma/client";

export class ProposalResponseError extends HttpError {
  constructor(status: number, message: string) {
    super(status, message);
    this.name = "ProposalResponseError";
  }
}

const VALID_RESPONSES: ProposalResponseType[] = ["INTERESTED", "NOT_INTERESTED", "NEED_MORE_INFO"];
const VALID_REASONS: ProposalDeclineReason[] = [
  "DIFFERENT_EXPECTATIONS",
  "LOCATION",
  "AGE",
  "EDUCATION",
  "PROFESSION",
  "FAMILY_PREFERENCE",
  "PERSONAL_PREFERENCE",
  "OTHER",
];

// Extracted verbatim from /api/my-proposals/respond (STEP 22 — so the
// applicant-confirmed family-decision flow, POST
// /api/my-proposals/[proposalCode]/confirm-family-decision, writes the exact
// same ProposalResponse/status-transition/audit/notification path rather
// than a parallel one). The actual ProposalResponse row this produces is
// ALWAYS applicant-attributed — a family member never calls this directly
// (see src/lib/family/decisions.ts's FamilyDecision, which is the only thing
// a family member can create — Decision 8).
export async function submitProposalResponse(
  profileId: string,
  proposalCode: string,
  response: ProposalResponseType,
  reason?: ProposalDeclineReason | null,
  reasonNote?: string | null
): Promise<{ ok: true }> {
  if (!VALID_RESPONSES.includes(response)) {
    throw new ProposalResponseError(400, "A valid response is required.");
  }
  if (reason && !VALID_REASONS.includes(reason)) {
    throw new ProposalResponseError(400, "Invalid reason.");
  }

  const proposal = await prisma.proposal.findUnique({ where: { proposalCode: proposalCode.trim().toUpperCase() } });
  if (!proposal || (proposal.profileAId !== profileId && proposal.profileBId !== profileId)) {
    throw new ProposalResponseError(404, "Proposal not found.");
  }

  await prisma.proposalResponse.upsert({
    where: { proposalId_profileId: { proposalId: proposal.id, profileId } },
    update: { response, reason: reason || null, reasonNote: reasonNote || null, respondedAt: new Date() },
    create: { proposalId: proposal.id, profileId, response, reason: reason || null, reasonNote: reasonNote || null },
  });

  const [responseA, responseB] = await Promise.all([
    prisma.proposalResponse.findUnique({ where: { proposalId_profileId: { proposalId: proposal.id, profileId: proposal.profileAId } } }),
    prisma.proposalResponse.findUnique({ where: { proposalId_profileId: { proposalId: proposal.id, profileId: proposal.profileBId } } }),
  ]);
  const newStatus = nextProposalStatus(proposal.status, responseA?.response, responseB?.response);

  await prisma.proposal.update({
    where: { id: proposal.id },
    data: { status: newStatus, events: { create: { status: newStatus, performedByProfileId: profileId } } },
  });

  await writeAudit({ action: "PROPOSAL_RESPONSE_SUBMITTED", targetProfileId: profileId, meta: { proposalId: proposal.id, response } });

  await notifyProposalResponseReceived({
    proposalId: proposal.id,
    profileAId: proposal.profileAId,
    profileBId: proposal.profileBId,
    responderId: profileId,
    response,
    newStatus,
    assignedToId: proposal.assignedToId,
  });

  return { ok: true };
}
