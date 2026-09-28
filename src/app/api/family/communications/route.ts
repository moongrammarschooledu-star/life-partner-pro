import { NextResponse } from "next/server";
import { requireFamilyMemberId } from "@/lib/family/require-family-member";
import { handleApiError } from "@/lib/route-guard";
import { listThreadsForFamilyMember } from "@/lib/communications/thread-service";

// A family member sees only conversations they were explicitly added to for THEIR applicant, and only while their access is active.
export async function GET() {
  try {
    const familyMemberId = await requireFamilyMemberId();
    if (!familyMemberId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    return NextResponse.json({ items: await listThreadsForFamilyMember(familyMemberId) });
  } catch (error) {
    return handleApiError(error);
  }
}
