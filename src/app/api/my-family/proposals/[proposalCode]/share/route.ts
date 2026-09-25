import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { writeAudit } from "@/lib/audit";
import { notifyFamilyProposalShared } from "@/lib/notifications/events";
import type { ProposalSharingLevel } from "@prisma/client";

const VALID_LEVELS: ProposalSharingLevel[] = ["SUMMARY", "STANDARD", "DETAILED", "RESPONSE_PARTICIPATION"];

// Spec §19/§20 — the applicant chooses which family member(s), what
// sharing level, and whether comments/response participation are allowed.
// Both the FamilyPermission capability (proposal.view, granted separately)
// AND this specific-instance FamilySharedRecord are required before the
// family member can see anything (Decision 7).
export async function POST(req: Request, { params }: { params: Promise<{ proposalCode: string }> }) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { proposalCode } = await params;
  const { familyMemberId, accessLevel, allowComments, allowResponse, expiresAt } = await req.json();

  if (!familyMemberId || !VALID_LEVELS.includes(accessLevel)) {
    return NextResponse.json({ error: "A family member and a valid sharing level are required." }, { status: 400 });
  }

  const proposal = await prisma.proposal.findUnique({ where: { proposalCode: proposalCode.trim().toUpperCase() } });
  if (!proposal || (proposal.profileAId !== profileId && proposal.profileBId !== profileId)) {
    return NextResponse.json({ error: "Proposal not found." }, { status: 404 });
  }

  const member = await prisma.familyMember.findFirst({ where: { id: familyMemberId, familyAccount: { applicantId: profileId }, status: "ACTIVE" } });
  if (!member) return NextResponse.json({ error: "Family member not found." }, { status: 404 });

  const share = await prisma.familySharedRecord.upsert({
    where: { familyMemberId_recordType_recordId: { familyMemberId, recordType: "PROPOSAL", recordId: proposal.id } },
    update: {
      accessLevel,
      allowComments: !!allowComments,
      allowResponse: accessLevel === "RESPONSE_PARTICIPATION" && !!allowResponse,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      status: "ACTIVE",
      sharedAt: new Date(),
      sharedByProfileId: profileId,
    },
    create: {
      familyMemberId,
      recordType: "PROPOSAL",
      recordId: proposal.id,
      accessLevel,
      allowComments: !!allowComments,
      allowResponse: accessLevel === "RESPONSE_PARTICIPATION" && !!allowResponse,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      sharedByProfileId: profileId,
    },
  });

  await writeAudit({ action: "FAMILY_PROPOSAL_SHARED", targetProfileId: profileId, meta: { familyMemberId, proposalId: proposal.id, accessLevel } });
  await notifyFamilyProposalShared(familyMemberId, proposal.id);

  return NextResponse.json({ id: share.id, accessLevel: share.accessLevel });
}
