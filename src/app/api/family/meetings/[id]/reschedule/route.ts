import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireFamilyMemberId } from "@/lib/family/require-family-member";
import { getFamilyMembership } from "@/lib/family/access-control";
import { applyMeetingUpdate, MeetingWorkflowError } from "@/lib/meeting-workflow";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const familyMemberId = await requireFamilyMemberId();
  if (!familyMemberId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const membership = await getFamilyMembership(familyMemberId);
  if (!membership) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  const { proposedAt, note } = await req.json();
  if (typeof proposedAt !== "string" || !proposedAt.trim()) {
    return NextResponse.json({ error: "A proposed new time is required." }, { status: 400 });
  }

  const meeting = await prisma.meeting.findUnique({ where: { id }, select: { proposalId: true } });
  if (!meeting) return NextResponse.json({ error: "Meeting not found." }, { status: 404 });

  const applicantNote = `Proposed new time: ${proposedAt}${note ? ` — ${note}` : ""}`;

  try {
    const updated = await applyMeetingUpdate(
      meeting.proposalId,
      id,
      { status: "RESCHEDULED", applicantRescheduleNote: applicantNote },
      { type: "family", familyMemberId, profileId: membership.applicantId }
    );
    return NextResponse.json({ id: updated.id, status: updated.status });
  } catch (error) {
    if (error instanceof MeetingWorkflowError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
