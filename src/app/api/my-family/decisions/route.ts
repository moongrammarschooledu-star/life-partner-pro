import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { listPendingFamilyDecisions } from "@/lib/family/decisions";

export async function GET() {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const items = await listPendingFamilyDecisions(profileId);
  return NextResponse.json({ items });
}
