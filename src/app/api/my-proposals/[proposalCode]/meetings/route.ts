import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { projectMeetingSummary } from "@/lib/visibility/proposal-visibility";

export async function GET(_req: Request, { params }: { params: Promise<{ proposalCode: string }> }) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { proposalCode } = await params;
  const proposal = await prisma.proposal.findUnique({
    where: { proposalCode: proposalCode.trim().toUpperCase() },
    include: { meetings: { orderBy: { scheduledAt: "asc" } } },
  });
  if (!proposal || (proposal.profileAId !== profileId && proposal.profileBId !== profileId)) {
    return NextResponse.json({ error: "Proposal not found." }, { status: 404 });
  }

  return NextResponse.json({ items: proposal.meetings.map(projectMeetingSummary) });
}
