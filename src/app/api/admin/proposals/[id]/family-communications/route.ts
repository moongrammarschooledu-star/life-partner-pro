import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { assertProposalAccess } from "@/lib/proposal-access";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("proposal:edit");
    const { id } = await params;
    const { profileId, contactPerson, relationship, communicationMethod, communicationDate, outcome, notes, nextFollowUpDate } = await req.json();

    if (!profileId || !contactPerson || !relationship || !communicationMethod || !communicationDate) {
      throw new ApiError(400, "contactPerson, relationship, communicationMethod, and communicationDate are required");
    }

    const proposal = await prisma.proposal.findUnique({ where: { id } });
    if (!proposal) throw new ApiError(404, "Proposal not found");
    assertProposalAccess(admin, proposal);
    if (profileId !== proposal.profileAId && profileId !== proposal.profileBId) {
      throw new ApiError(400, "Profile is not part of this proposal");
    }

    const entry = await prisma.familyCommunication.create({
      data: {
        proposalId: id,
        profileId,
        contactPerson,
        relationship,
        communicationMethod,
        communicationDate: new Date(communicationDate),
        outcome: outcome || null,
        notes: notes || null,
        nextFollowUpDate: nextFollowUpDate ? new Date(nextFollowUpDate) : null,
        createdById: admin.id,
      },
    });

    if (proposal.status !== "FAMILIES_CONTACTED") {
      await prisma.proposal.update({
        where: { id },
        data: { status: "FAMILIES_CONTACTED", events: { create: { status: "FAMILIES_CONTACTED", performedByAdminId: admin.id } } },
      });
    }

    await writeAudit({ action: "FAMILY_COMMUNICATION_LOGGED", adminId: admin.id, targetProfileId: profileId, meta: { proposalId: id, entryId: entry.id } });

    return NextResponse.json(entry);
  } catch (error) {
    return handleApiError(error);
  }
}
