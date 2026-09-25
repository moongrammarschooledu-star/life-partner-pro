import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";

// Every PENDING_APPROVAL FamilyPermission row — created whenever an
// applicant grants a sensitive family scope (src/lib/family/grants.ts).
// This is the STEP 19 checker's queue for FAMILY_ACCESS_GRANT.
export async function GET() {
  try {
    await requireAdmin("family:manage");
    const items = await prisma.familyPermission.findMany({
      where: { status: "PENDING_APPROVAL" },
      include: {
        familyMember: { select: { fullName: true, relationship: true, familyAccount: { select: { applicantId: true, applicant: { select: { profileCode: true } } } } } },
      },
      orderBy: { grantedAt: "asc" },
    });
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}
