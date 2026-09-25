import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";

// The Family Access Permission Center's member list (spec §12/§17) — scoped
// strictly to this applicant's own FamilyAccount, never a client-supplied id.
export async function GET() {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const account = await prisma.familyAccount.findUnique({ where: { applicantId: profileId } });
  if (!account) return NextResponse.json({ items: [] });

  const members = await prisma.familyMember.findMany({
    where: { familyAccountId: account.id },
    select: { id: true, fullName: true, relationship: true, role: true, status: true, email: true, mobile: true, joinedAt: true, lastLoginAt: true, invitedAt: true },
    orderBy: { invitedAt: "desc" },
  });

  const permissions = await prisma.familyPermission.findMany({
    where: { familyMemberId: { in: members.map((m) => m.id) } },
    select: { familyMemberId: true, permission: true, scope: true, status: true, grantedAt: true, expiresAt: true },
  });

  return NextResponse.json({
    items: members.map((m) => ({ ...m, permissions: permissions.filter((p) => p.familyMemberId === m.id) })),
  });
}
