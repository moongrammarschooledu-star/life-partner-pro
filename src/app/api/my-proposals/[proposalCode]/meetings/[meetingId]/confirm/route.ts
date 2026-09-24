import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { applyMeetingUpdate, MeetingWorkflowError } from "@/lib/meeting-workflow";

export async function POST(_req: Request, { params }: { params: Promise<{ proposalCode: string; meetingId: string }> }) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { proposalCode, meetingId } = await params;
  const proposal = await prisma.proposal.findUnique({ where: { proposalCode: proposalCode.trim().toUpperCase() }, select: { id: true } });
  if (!proposal) return NextResponse.json({ error: "Proposal not found." }, { status: 404 });

  try {
    const meeting = await applyMeetingUpdate(proposal.id, meetingId, { status: "CONFIRMED" }, { type: "applicant", profileId });
    return NextResponse.json({ id: meeting.id, status: meeting.status });
  } catch (error) {
    if (error instanceof MeetingWorkflowError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
