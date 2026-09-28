import { NextResponse } from "next/server";
import { requireFamilyMemberId } from "@/lib/family/require-family-member";
import { handleApiError } from "@/lib/route-guard";
import { getThreadForFamilyMember } from "@/lib/communications/thread-service";

// Read-only for family members in this release. PUBLIC_TO_USER messages only; a missing, foreign or revoked conversation is a 404.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const familyMemberId = await requireFamilyMemberId();
    if (!familyMemberId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const { id } = await params;
    return NextResponse.json(await getThreadForFamilyMember(familyMemberId, id));
  } catch (error) {
    return handleApiError(error);
  }
}
