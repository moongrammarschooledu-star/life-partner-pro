import { NextResponse } from "next/server";
import { requireFamilyMemberId } from "@/lib/family/require-family-member";
import { getVisibleApplicantProfile, getVisibleVerificationStatus } from "@/lib/family/data-visibility";

export async function GET() {
  const familyMemberId = await requireFamilyMemberId();
  if (!familyMemberId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const profile = await getVisibleApplicantProfile(familyMemberId);
  if (!profile) return NextResponse.json({ error: "Not authorized to view this profile." }, { status: 403 });

  // STEP 23 §45 — null (not an error) when the applicant hasn't granted
  // profile.verification.view; the coarse status/level only, never documents
  // or risk signals (see the hard-deny stubs in data-visibility.ts).
  const verification = await getVisibleVerificationStatus(familyMemberId);

  return NextResponse.json({ ...profile, verification });
}
