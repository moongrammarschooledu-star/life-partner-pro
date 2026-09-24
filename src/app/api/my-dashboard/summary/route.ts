import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { projectSelfStatus } from "@/lib/visibility/user-data-visibility";

// STEP 21 — dashboard hub aggregation. Thin composition of already-narrow,
// already-existing queries; no new heavy query beyond what each individual
// /my-* page already runs.
export async function GET() {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    select: { profileCode: true, status: true, verified: true, profileCompletion: true, createdAt: true, softDeleted: true },
  });
  if (!profile || profile.softDeleted) return NextResponse.json({ error: "Not found." }, { status: 401 });

  const [proposalCounts, upcomingMeetings, unreadNotifications, pendingPrivacyRequests, pendingUpdate] = await Promise.all([
    prisma.proposal.groupBy({
      by: ["status"],
      where: { OR: [{ profileAId: profileId }, { profileBId: profileId }] },
      _count: true,
    }),
    prisma.meeting.findMany({
      where: {
        proposal: { OR: [{ profileAId: profileId }, { profileBId: profileId }] },
        scheduledAt: { gte: new Date() },
        status: { notIn: ["CANCELLED", "COMPLETED"] },
      },
      select: { id: true, scheduledAt: true, meetingType: true, status: true },
      orderBy: { scheduledAt: "asc" },
      take: 5,
    }),
    prisma.notification.count({ where: { recipientProfileId: profileId, readAt: null } }),
    prisma.privacyRequest.count({ where: { profileId, status: { in: ["SUBMITTED", "UNDER_REVIEW", "IN_PROGRESS"] } } }),
    prisma.pendingUpdate.findUnique({ where: { profileId }, select: { submittedAt: true } }),
  ]);

  return NextResponse.json({
    status: projectSelfStatus(profile),
    totalProposals: proposalCounts.reduce((sum, g) => sum + g._count, 0),
    proposalsByStatus: proposalCounts.map((g) => ({ status: g.status, count: g._count })),
    upcomingMeetings,
    unreadNotifications,
    pendingPrivacyRequests,
    hasPendingUpdate: !!pendingUpdate,
    pendingUpdateSubmittedAt: pendingUpdate?.submittedAt ?? null,
  });
}
