import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { assertProposalAccess } from "@/lib/proposal-access";
import type { MeetingStatus } from "@prisma/client";

const VALID_STATUSES: MeetingStatus[] = ["REQUESTED", "SCHEDULED", "CONFIRMED", "COMPLETED", "RESCHEDULED", "CANCELLED"];

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; meetingId: string }> }) {
  try {
    const admin = await requireAdmin("proposal:edit");
    const { id, meetingId } = await params;
    const { status, scheduledAt, locationInfo, notes } = await req.json();

    if (status && !VALID_STATUSES.includes(status)) throw new ApiError(400, "Invalid status");

    const proposal = await prisma.proposal.findUnique({ where: { id } });
    if (!proposal) throw new ApiError(404, "Proposal not found");
    assertProposalAccess(admin, proposal);

    const meeting = await prisma.meeting.update({
      where: { id: meetingId },
      data: {
        ...(status ? { status } : {}),
        ...(scheduledAt ? { scheduledAt: new Date(scheduledAt) } : {}),
        ...(locationInfo !== undefined ? { locationInfo: locationInfo || null } : {}),
        ...(notes !== undefined ? { notes: notes || null } : {}),
      },
    });

    if (status === "COMPLETED" && proposal.status !== "MEETING_COMPLETED") {
      await prisma.proposal.update({
        where: { id },
        data: { status: "MEETING_COMPLETED", events: { create: { status: "MEETING_COMPLETED", performedByAdminId: admin.id } } },
      });
    }

    await writeAudit({ action: "MEETING_MODIFIED", adminId: admin.id, targetProfileId: proposal.profileAId, meta: { proposalId: id, meetingId, status } });

    return NextResponse.json(meeting);
  } catch (error) {
    return handleApiError(error);
  }
}
