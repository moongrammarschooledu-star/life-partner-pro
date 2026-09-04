import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { assertProposalAccess } from "@/lib/proposal-access";
import { nextProposalStatus } from "@/lib/proposal-workflow";
import type { ProposalResponseType, ProposalDeclineReason } from "@prisma/client";

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

// Lets an admin record a response on a profile's behalf (e.g. the applicant
// called in by phone) — runs through the same nextProposalStatus() pure
// transition the applicant-facing respond endpoint uses.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("proposal:edit");
    const { id } = await params;
    const { profileId, response, reason, reasonNote } = await req.json();

    if (!VALID_RESPONSES.includes(response)) throw new ApiError(400, "Invalid response");
    if (reason && !VALID_REASONS.includes(reason)) throw new ApiError(400, "Invalid reason");

    const proposal = await prisma.proposal.findUnique({ where: { id } });
    if (!proposal) throw new ApiError(404, "Proposal not found");
    assertProposalAccess(admin, proposal);
    if (profileId !== proposal.profileAId && profileId !== proposal.profileBId) {
      throw new ApiError(400, "Profile is not part of this proposal");
    }

    await prisma.proposalResponse.upsert({
      where: { proposalId_profileId: { proposalId: id, profileId } },
      update: { response, reason: reason || null, reasonNote: reasonNote || null, respondedAt: new Date() },
      create: { proposalId: id, profileId, response, reason: reason || null, reasonNote: reasonNote || null },
    });

    const [responseA, responseB] = await Promise.all([
      prisma.proposalResponse.findUnique({ where: { proposalId_profileId: { proposalId: id, profileId: proposal.profileAId } } }),
      prisma.proposalResponse.findUnique({ where: { proposalId_profileId: { proposalId: id, profileId: proposal.profileBId } } }),
    ]);

    const newStatus = nextProposalStatus(proposal.status, responseA?.response, responseB?.response);

    await prisma.proposal.update({
      where: { id },
      data: {
        status: newStatus,
        events: { create: { status: newStatus, note: `Response recorded on behalf of profile by admin.`, performedByAdminId: admin.id } },
      },
    });

    await writeAudit({ action: "PROPOSAL_RESPONSE_SUBMITTED", adminId: admin.id, targetProfileId: profileId, meta: { proposalId: id, response } });

    return NextResponse.json({ status: newStatus });
  } catch (error) {
    return handleApiError(error);
  }
}
