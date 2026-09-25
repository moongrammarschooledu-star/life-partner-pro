import { NextResponse } from "next/server";
import { requireFamilyMemberId } from "@/lib/family/require-family-member";
import { getFamilyPermissions } from "@/lib/family/access-control";
import { prisma } from "@/lib/prisma";

// Spec §40 — "what they can access, why, who granted it, when it expires,
// what information is shared." Never exposes anything about another family
// member or the applicant's data beyond this member's own grant metadata.
export async function GET() {
  const familyMemberId = await requireFamilyMemberId();
  if (!familyMemberId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const [permissions, sharedRecords] = await Promise.all([
    getFamilyPermissions(familyMemberId),
    prisma.familySharedRecord.findMany({ where: { familyMemberId, status: "ACTIVE" }, select: { recordType: true, accessLevel: true, allowComments: true, allowResponse: true, sharedAt: true, expiresAt: true } }),
  ]);

  return NextResponse.json({
    permissions: permissions.map((p) => ({ permission: p.permission, grantedAt: p.grantedAt, expiresAt: p.expiresAt, grantedByApplicant: !!p.grantedByProfileId })),
    sharedRecords,
  });
}
