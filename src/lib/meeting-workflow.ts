import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { writeAudit } from "@/lib/audit";
import { notifyMeetingUpdated, notifyFamilyMeetingUpdated } from "@/lib/notifications/events";
import { getSharedRecord, hasFamilyPermission } from "@/lib/family/access-control";
import type { MeetingStatus } from "@prisma/client";

export class MeetingWorkflowError extends HttpError {
  constructor(status: number, message: string) {
    super(status, message);
    this.name = "MeetingWorkflowError";
  }
}

// STEP 22 — the "family" variant carries profileId (the linked applicant,
// resolved server-side via getFamilyMembership — never client-supplied) so
// this function can check proposal membership the same way as "applicant",
// while familyMemberId identifies whose FamilySharedRecord/FamilyPermission
// grants to check.
export type MeetingActor = { type: "admin"; adminId: string } | { type: "applicant"; profileId: string } | { type: "family"; familyMemberId: string; profileId: string };

const VALID_STATUSES: MeetingStatus[] = ["REQUESTED", "SCHEDULED", "CONFIRMED", "COMPLETED", "RESCHEDULED", "CANCELLED"];

// STEP 21 Decision 4 — an applicant may only confirm, propose a reschedule
// (never move scheduledAt directly — that stays admin-committed), or
// cancel. They can never mark COMPLETED (a staff/family-observed outcome)
// or create a meeting at all.
const APPLICANT_ALLOWED_TARGET: Record<MeetingStatus, MeetingStatus[]> = {
  REQUESTED: ["CONFIRMED", "CANCELLED"],
  SCHEDULED: ["CONFIRMED", "RESCHEDULED", "CANCELLED"],
  CONFIRMED: ["RESCHEDULED", "CANCELLED"],
  RESCHEDULED: ["CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

// STEP 22 — narrower than the applicant's own set (spec §25: "confirm
// meeting, request reschedule... They cannot modify meeting ownership").
// Notably no CANCELLED — only the applicant (or admin) can cancel a meeting.
const FAMILY_ALLOWED_TARGET: Record<MeetingStatus, MeetingStatus[]> = {
  REQUESTED: ["CONFIRMED"],
  SCHEDULED: ["CONFIRMED", "RESCHEDULED"],
  CONFIRMED: ["RESCHEDULED"],
  RESCHEDULED: [],
  COMPLETED: [],
  CANCELLED: [],
};

export interface MeetingUpdateInput {
  status?: MeetingStatus;
  scheduledAt?: string | Date;
  locationInfo?: string | null;
  notes?: string | null;
  // Applicant-only (Decision 4): a proposed new time/reason, appended to the
  // meeting's notes rather than moving scheduledAt directly — the actual
  // re-commit stays admin-driven so a family-coordinated slot can never be
  // unilaterally double-booked by one side.
  applicantRescheduleNote?: string;
}

// Extracted from the admin PATCH .../meetings/[meetingId] route
// (behavior-preserving for the admin actor — same audit action name, same
// notification, same MEETING_COMPLETED proposal-status side effect).
// Scoped by BOTH meetingId and proposalId at the Prisma call itself (the
// original admin route only filtered by meetingId — this closes that gap
// for every caller, admin included, rather than leaving it open only for
// applicants).
export async function applyMeetingUpdate(proposalId: string, meetingId: string, changes: MeetingUpdateInput, actor: MeetingActor) {
  if (changes.status && !VALID_STATUSES.includes(changes.status)) {
    throw new MeetingWorkflowError(400, "Invalid status");
  }

  const proposal = await prisma.proposal.findUnique({ where: { id: proposalId } });
  if (!proposal) throw new MeetingWorkflowError(404, "Proposal not found");

  const meeting = await prisma.meeting.findFirst({ where: { id: meetingId, proposalId } });
  if (!meeting) throw new MeetingWorkflowError(404, "Meeting not found");

  if (actor.type === "applicant") {
    if (proposal.profileAId !== actor.profileId && proposal.profileBId !== actor.profileId) {
      throw new MeetingWorkflowError(404, "Meeting not found");
    }
    if (changes.scheduledAt !== undefined) {
      throw new MeetingWorkflowError(403, "Only staff can commit a new meeting time. Propose a new time via reschedule notes instead.");
    }
    if (changes.status && !APPLICANT_ALLOWED_TARGET[meeting.status].includes(changes.status)) {
      throw new MeetingWorkflowError(403, "This meeting status change isn't available to you.");
    }
  }

  if (actor.type === "family") {
    if (proposal.profileAId !== actor.profileId && proposal.profileBId !== actor.profileId) {
      throw new MeetingWorkflowError(404, "Meeting not found");
    }
    // Both the specific-instance share AND the capability permission are
    // required (Decision 7) — a FamilyPermission alone never suffices.
    const share = await getSharedRecord(actor.familyMemberId, "MEETING", meetingId);
    if (!share) throw new MeetingWorkflowError(404, "Meeting not found");
    if (changes.scheduledAt !== undefined) {
      throw new MeetingWorkflowError(403, "Only staff can commit a new meeting time. Propose a new time via reschedule notes instead.");
    }
    if (changes.status && !FAMILY_ALLOWED_TARGET[meeting.status].includes(changes.status)) {
      throw new MeetingWorkflowError(403, "This meeting status change isn't available to you.");
    }
    const requiredPermission = changes.status === "CONFIRMED" ? "meeting.confirm" : changes.status === "RESCHEDULED" ? "meeting.reschedule" : null;
    if (requiredPermission && !(await hasFamilyPermission(actor.familyMemberId, requiredPermission))) {
      throw new MeetingWorkflowError(403, "You don't have permission to make this change.");
    }
  }

  let notes = changes.notes;
  if (changes.applicantRescheduleNote) {
    const stamp = new Date().toISOString();
    const who = actor.type === "family" ? "A family member" : "Applicant";
    const appended = `[${who} proposed a new time — ${stamp}]: ${changes.applicantRescheduleNote}`;
    notes = meeting.notes ? `${meeting.notes}\n${appended}` : appended;
  }

  const updated = await prisma.meeting.update({
    where: { id: meetingId },
    data: {
      ...(changes.status ? { status: changes.status } : {}),
      ...(changes.scheduledAt ? { scheduledAt: new Date(changes.scheduledAt) } : {}),
      ...(changes.locationInfo !== undefined ? { locationInfo: changes.locationInfo || null } : {}),
      ...(notes !== undefined ? { notes: notes || null } : {}),
    },
  });

  if (changes.status === "COMPLETED" && proposal.status !== "MEETING_COMPLETED") {
    await prisma.proposal.update({
      where: { id: proposalId },
      data: { status: "MEETING_COMPLETED", events: { create: { status: "MEETING_COMPLETED", performedByAdminId: actor.type === "admin" ? actor.adminId : undefined } } },
    });
  }

  const auditAction =
    actor.type === "admin"
      ? "MEETING_MODIFIED"
      : actor.type === "family"
        ? "FAMILY_MEETING_ACTION"
        : changes.status === "CONFIRMED"
          ? "MEETING_CONFIRMED_BY_APPLICANT"
          : changes.status === "CANCELLED"
            ? "MEETING_CANCELLED_BY_APPLICANT"
            : "MEETING_RESCHEDULE_REQUESTED_BY_APPLICANT";

  await writeAudit({
    action: auditAction,
    adminId: actor.type === "admin" ? actor.adminId : null,
    actorFamilyMemberId: actor.type === "family" ? actor.familyMemberId : null,
    targetProfileId: proposal.profileAId,
    meta: { proposalId, meetingId, status: changes.status },
  });

  if (changes.status) {
    await notifyMeetingUpdated(proposal.profileAId, proposal.profileBId, proposalId, changes.status, proposal.assignedToId);

    const familyShares = await prisma.familySharedRecord.findMany({ where: { recordType: "MEETING", recordId: meetingId, status: "ACTIVE" }, select: { familyMemberId: true } });
    if (familyShares.length > 0) {
      await notifyFamilyMeetingUpdated(familyShares.map((s) => s.familyMemberId), proposalId);
    }
  }

  return updated;
}
