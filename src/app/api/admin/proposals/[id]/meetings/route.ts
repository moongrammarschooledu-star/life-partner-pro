import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { assertProposalAccess } from "@/lib/proposal-access";
import type { MeetingType } from "@prisma/client";

const VALID_TYPES: MeetingType[] = ["FAMILY_MEETING", "INITIAL_MEETING", "ONLINE_MEETING", "PHONE_DISCUSSION", "IN_PERSON_MEETING", "OTHER"];

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("proposal:edit");
    const { id } = await params;
    const { meetingType, scheduledAt, locationInfo, participants, notes, followUpDate } = await req.json();

    if (!VALID_TYPES.includes(meetingType)) throw new ApiError(400, "Invalid meeting type");
    if (!scheduledAt) throw new ApiError(400, "A meeting date/time is required");

    const proposal = await prisma.proposal.findUnique({ where: { id } });
    if (!proposal) throw new ApiError(404, "Proposal not found");
    assertProposalAccess(admin, proposal);

    const meeting = await prisma.meeting.create({
      data: {
        proposalId: id,
        meetingType,
        scheduledAt: new Date(scheduledAt),
        locationInfo: locationInfo || null,
        participants: participants || null,
        notes: notes || null,
        followUpDate: followUpDate ? new Date(followUpDate) : null,
        createdById: admin.id,
      },
    });

    if (proposal.status !== "MEETING_SCHEDULED" && proposal.status !== "MEETING_COMPLETED") {
      await prisma.proposal.update({
        where: { id },
        data: { status: "MEETING_SCHEDULED", events: { create: { status: "MEETING_SCHEDULED", performedByAdminId: admin.id } } },
      });
    }

    await writeAudit({ action: "MEETING_CREATED", adminId: admin.id, targetProfileId: proposal.profileAId, meta: { proposalId: id, meetingId: meeting.id } });

    return NextResponse.json(meeting);
  } catch (error) {
    return handleApiError(error);
  }
}
