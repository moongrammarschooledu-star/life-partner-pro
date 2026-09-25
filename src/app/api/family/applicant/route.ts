import { NextResponse } from "next/server";
import { requireFamilyMemberId } from "@/lib/family/require-family-member";
import { getVisibleApplicantProfile } from "@/lib/family/data-visibility";

export async function GET() {
  const familyMemberId = await requireFamilyMemberId();
  if (!familyMemberId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const profile = await getVisibleApplicantProfile(familyMemberId);
  if (!profile) return NextResponse.json({ error: "Not authorized to view this profile." }, { status: 403 });

  return NextResponse.json(profile);
}
