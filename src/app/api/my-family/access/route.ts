import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";

// The Family Access Permission Center (spec §12) — member + role + access
// level + permissions + shared records + expiration + status, all in one
// read, scoped strictly to this applicant's own FamilyAccount.
export async function GET() {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const account = await prisma.familyAccount.findUnique({ where: { applicantId: profileId } });
  if (!account) return NextResponse.json({ items: [] });

  const members = await prisma.familyMember.findMany({
    where: { familyAccountId: account.id },
    select: { id: true, fullName: true, relationship: true, role: true, status: true, invitedAt: true, joinedAt: true, lastLoginAt: true },
    orderBy: { invitedAt: "desc" },
  });
  const memberIds = members.map((m) => m.id);

  const [permissions, sharedRecords] = await Promise.all([
    prisma.familyPermission.findMany({ where: { familyMemberId: { in: memberIds } }, select: { familyMemberId: true, permission: true, scope: true, status: true, grantedAt: true, expiresAt: true } }),
    prisma.familySharedRecord.findMany({ where: { familyMemberId: { in: memberIds } }, select: { familyMemberId: true, recordType: true, recordId: true, accessLevel: true, status: true, sharedAt: true, expiresAt: true } }),
  ]);

  return NextResponse.json({
    items: members.map((m) => ({
      ...m,
      permissions: permissions.filter((p) => p.familyMemberId === m.id),
      sharedRecords: sharedRecords.filter((s) => s.familyMemberId === m.id),
    })),
  });
}
