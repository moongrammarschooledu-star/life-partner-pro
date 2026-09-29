import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { handleApiError } from "@/lib/route-guard";
import { listRequests } from "@/lib/documents/request-service";

// The applicant's own list of document requests from staff (spec §38).
export async function GET() {
  try {
    const profileId = await requireApplicantProfileId();
    if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const items = await listRequests({ requestedFromId: profileId, take: 100 });
    return NextResponse.json({ items: items.filter((r) => r.requestedFromType === "PROFILE") });
  } catch (error) {
    return handleApiError(error);
  }
}
