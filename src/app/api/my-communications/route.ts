import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { handleApiError } from "@/lib/route-guard";
import { listThreadsForProfile } from "@/lib/communications/thread-service";

// The signed-in applicant's own conversations with the team. A conversation is always applicant <-> staff; an applicant can never
// start one, be added to one with another applicant, or see internal messages.
export async function GET() {
  try {
    const profileId = await requireApplicantProfileId();
    if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    return NextResponse.json({ items: await listThreadsForProfile(profileId) });
  } catch (error) {
    return handleApiError(error);
  }
}
