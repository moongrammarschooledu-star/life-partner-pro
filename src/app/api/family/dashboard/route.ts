import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireFamilyMemberId } from "@/lib/family/require-family-member";
import { getFamilyMembership, getFamilyPermissions } from "@/lib/family/access-control";
import { getVisibleApplicantProfile, getVisibleProposals, getVisibleMeetings } from "@/lib/family/data-visibility";

export async function GET() {
  const familyMemberId = await requireFamilyMemberId();
  if (!familyMemberId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const membership = await getFamilyMembership(familyMemberId);
  if (!membership) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const [member, applicant, proposals, meetings, permissions, unreadNotifications] = await Promise.all([
    prisma.familyMember.findUnique({ where: { id: familyMemberId }, select: { fullName: true, relationship: true, role: true } }),
    getVisibleApplicantProfile(familyMemberId),
    getVisibleProposals(familyMemberId),
    getVisibleMeetings(familyMemberId),
    getFamilyPermissions(familyMemberId),
    prisma.notification.count({ where: { recipientFamilyMemberId: familyMemberId, readAt: null } }),
  ]);

  return NextResponse.json({
    me: member,
    applicant: applicant ? { profileCode: applicant.profileCode, status: applicant.status, profileCompletion: applicant.profileCompletion, verified: applicant.verified } : null,
    proposalCount: proposals.length,
    pendingFamilyDecisions: proposals.filter((p) => p.canRespond).length,
    upcomingMeetings: meetings.filter((m) => m.scheduledAt > new Date() && m.status !== "CANCELLED" && m.status !== "COMPLETED"),
    unreadNotifications,
    permissions: permissions.map((p) => p.permission),
  });
}
