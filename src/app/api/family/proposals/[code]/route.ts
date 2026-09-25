import { NextResponse } from "next/server";
import { requireFamilyMemberId } from "@/lib/family/require-family-member";
import { getVisibleProposal } from "@/lib/family/data-visibility";

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const familyMemberId = await requireFamilyMemberId();
  if (!familyMemberId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { code } = await params;
  const proposal = await getVisibleProposal(familyMemberId, code);
  if (!proposal) return NextResponse.json({ error: "Proposal not found." }, { status: 404 });

  return NextResponse.json(proposal);
}
