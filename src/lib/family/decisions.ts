import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { writeAudit } from "@/lib/audit";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { canRespond, getFamilyMembership } from "@/lib/family/access-control";
import { submitProposalResponse } from "@/lib/proposal-response";
import { notifyFamilyDecisionRequested } from "@/lib/notifications/events";
import type { FamilyDecisionValue, ProposalResponseType } from "@prisma/client";

export class FamilyDecisionError extends HttpError {
  constructor(status: number, message: string) {
    super(status, message);
    this.name = "FamilyDecisionError";
  }
}

// Decision 8 — a family member's suggested response is ALWAYS a FamilyDecision,
// never a direct ProposalResponse write. canRespond() already requires both a
// RESPONSE_PARTICIPATION-level FamilySharedRecord (allowResponse: true) and
// the proposal.respond capability (Decision 7's "record-and-permission both
// required" rule).
export async function suggestProposalResponse(params: {
  familyMemberId: string;
  proposalId: string;
  decision: FamilyDecisionValue;
  comment?: string;
}) {
  const allowed = await canRespond(params.familyMemberId, params.proposalId);
  if (!allowed) throw new FamilyDecisionError(403, "You don't have permission to suggest a response for this proposal.");

  const membership = await getFamilyMembership(params.familyMemberId);
  if (!membership) throw new FamilyDecisionError(403, "Not authorized.");

  const decisionCode = await nextSequenceCode("FAMDEC");
  const row = await prisma.familyDecision.create({
    data: {
      decisionCode,
      proposalId: params.proposalId,
      familyMemberId: params.familyMemberId,
      decision: params.decision,
      comment: params.comment ?? null,
      status: "APPLICANT_CONFIRMATION_REQUIRED",
    },
  });

  await writeAudit({
    action: "FAMILY_DECISION_CREATED",
    targetProfileId: membership.applicantId,
    actorFamilyMemberId: params.familyMemberId,
    meta: { proposalId: params.proposalId, decision: params.decision },
  });
  await notifyFamilyDecisionRequested(membership.applicantId, params.proposalId);

  return row;
}

const DECISION_TO_RESPONSE: Record<FamilyDecisionValue, ProposalResponseType> = {
  INTERESTED: "INTERESTED",
  NOT_INTERESTED: "NOT_INTERESTED",
  NEED_MORE_INFO: "NEED_MORE_INFO",
};

// The applicant's own confirmation — the ONLY path that ever converts a
// family suggestion into a real ProposalResponse, via the exact same
// submitProposalResponse() the applicant's own direct-response route uses
// (Decision 8). Scoped to the confirming applicant's own proposals only.
export async function confirmFamilyDecision(applicantId: string, decisionId: string): Promise<{ ok: true }> {
  const decision = await prisma.familyDecision.findFirst({
    where: { id: decisionId, proposal: { OR: [{ profileAId: applicantId }, { profileBId: applicantId }] } },
  });
  if (!decision) throw new FamilyDecisionError(404, "Decision not found.");
  if (decision.status !== "APPLICANT_CONFIRMATION_REQUIRED") {
    throw new FamilyDecisionError(409, "This decision is not awaiting confirmation.");
  }

  const proposal = await prisma.proposal.findUnique({ where: { id: decision.proposalId }, select: { proposalCode: true } });
  if (!proposal?.proposalCode) throw new FamilyDecisionError(404, "Proposal not found.");

  await submitProposalResponse(applicantId, proposal.proposalCode, DECISION_TO_RESPONSE[decision.decision]);

  await prisma.familyDecision.update({ where: { id: decisionId }, data: { status: "CONFIRMED", confirmedAt: new Date() } });
  await writeAudit({ action: "FAMILY_DECISION_CONFIRMED", targetProfileId: applicantId, meta: { decisionId, proposalId: decision.proposalId } });

  return { ok: true };
}

export async function cancelFamilyDecision(applicantId: string, decisionId: string): Promise<void> {
  const result = await prisma.familyDecision.updateMany({
    where: { id: decisionId, proposal: { OR: [{ profileAId: applicantId }, { profileBId: applicantId }] }, status: "APPLICANT_CONFIRMATION_REQUIRED" },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
  if (result.count === 0) throw new FamilyDecisionError(404, "Decision not found or already resolved.");
}

export async function listPendingFamilyDecisions(applicantId: string) {
  return prisma.familyDecision.findMany({
    where: { proposal: { OR: [{ profileAId: applicantId }, { profileBId: applicantId }] }, status: "APPLICANT_CONFIRMATION_REQUIRED" },
    include: { proposal: { select: { proposalCode: true } }, familyMember: { select: { fullName: true, relationship: true } } },
    orderBy: { createdAt: "desc" },
  });
}
