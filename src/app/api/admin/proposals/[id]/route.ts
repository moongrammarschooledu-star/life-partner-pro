import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import type { ProposalStatus } from "@prisma/client";

const VALID_STATUSES: ProposalStatus[] = ["DRAFT", "SENT", "INTERESTED", "NOT_INTERESTED", "WAITING", "MEETING", "FINALIZED", "CLOSED"];

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("proposal:create");
    const { id } = await params;

    const proposal = await prisma.proposal.findUnique({
      where: { id },
      include: {
        profileA: { select: { id: true, profileCode: true, fullName: true, gender: true } },
        profileB: { select: { id: true, profileCode: true, fullName: true, gender: true } },
        events: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!proposal) throw new ApiError(404, "Proposal not found");

    return NextResponse.json(proposal);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("proposal:edit");
    const { id } = await params;
    const { status, note } = await req.json();

    if (!VALID_STATUSES.includes(status)) throw new ApiError(400, "Invalid status");

    const proposal = await prisma.proposal.update({
      where: { id },
      data: {
        status,
        events: { create: { status, note: note || null } },
      },
    });

    if (status === "FINALIZED") {
      await Promise.all([
        prisma.profile.update({ where: { id: proposal.profileAId }, data: { status: "FINALIZED" } }),
        prisma.profile.update({ where: { id: proposal.profileBId }, data: { status: "FINALIZED" } }),
      ]);
    }

    await writeAudit({ action: "PROPOSAL_STATUS_CHANGED", adminId: admin.id, targetProfileId: proposal.profileAId, meta: { proposalId: id, status } });

    return NextResponse.json({ status: proposal.status });
  } catch (error) {
    return handleApiError(error);
  }
}
