import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";

// STEP 21 Decision 5 — narrow view of the applicant's own FamilyCommunication
// rows (admin-authored family-outreach log, STEP 7). Deliberately excludes
// `notes` (admin free text, may carry internal commentary) — mirrors the
// "never admin notes" discipline applied to ProposalVisibilityService.
// Requesting family outreach is done through the existing Support Center
// (/my-cases/new with category FAMILY_INTERACTION_REQUEST) rather than a
// parallel inbox.
export async function GET() {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const items = await prisma.familyCommunication.findMany({
    where: { profileId },
    select: {
      id: true,
      proposalId: true,
      contactPerson: true,
      relationship: true,
      communicationMethod: true,
      communicationDate: true,
      outcome: true,
      nextFollowUpDate: true,
      createdAt: true,
    },
    orderBy: { communicationDate: "desc" },
  });

  return NextResponse.json({ items });
}
