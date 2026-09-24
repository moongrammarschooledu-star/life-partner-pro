import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { assertProposalAccess } from "@/lib/proposal-access";
import { applyMeetingUpdate, MeetingWorkflowError } from "@/lib/meeting-workflow";
import type { MeetingStatus } from "@prisma/client";

// Extracted into src/lib/meeting-workflow.ts (STEP 21) so the applicant-facing
// meeting routes can reuse the exact same transition/audit/notification
// logic instead of a parallel implementation.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; meetingId: string }> }) {
  try {
    const admin = await requireAdmin("proposal:edit");
    const { id, meetingId } = await params;
    const { status, scheduledAt, locationInfo, notes } = (await req.json()) as {
      status?: MeetingStatus;
      scheduledAt?: string;
      locationInfo?: string | null;
      notes?: string | null;
    };

    const proposal = await prisma.proposal.findUnique({ where: { id } });
    if (!proposal) throw new ApiError(404, "Proposal not found");
    assertProposalAccess(admin, proposal);

    const meeting = await applyMeetingUpdate(id, meetingId, { status, scheduledAt, locationInfo, notes }, { type: "admin", adminId: admin.id });
    return NextResponse.json(meeting);
  } catch (error) {
    if (error instanceof MeetingWorkflowError) return NextResponse.json({ error: error.message }, { status: error.status });
    return handleApiError(error);
  }
}
