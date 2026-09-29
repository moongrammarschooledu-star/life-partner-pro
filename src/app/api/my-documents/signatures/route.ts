import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { handleApiError } from "@/lib/route-guard";
import { listSignatureRequestsForRecipient } from "@/lib/documents/signature-service";

export async function GET() {
  try {
    const profileId = await requireApplicantProfileId();
    if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const items = await listSignatureRequestsForRecipient("PROFILE", profileId);
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}
