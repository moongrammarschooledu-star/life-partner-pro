import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";

export async function GET() {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const items = await prisma.familyAccessRequest.findMany({
    where: { applicantId: profileId },
    include: { familyMember: { select: { fullName: true, relationship: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ items });
}
