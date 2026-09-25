import { NextResponse } from "next/server";
import { requireFamilyMemberId } from "@/lib/family/require-family-member";
import { getVisibleProposals } from "@/lib/family/data-visibility";

export async function GET() {
  const familyMemberId = await requireFamilyMemberId();
  if (!familyMemberId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const items = await getVisibleProposals(familyMemberId);
  return NextResponse.json({ items });
}
