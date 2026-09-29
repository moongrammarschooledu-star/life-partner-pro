import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { handleApiError, ApiError } from "@/lib/route-guard";
import { getSignatureRequest, markViewed } from "@/lib/documents/signature-service";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const profileId = await requireApplicantProfileId();
    if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const { id } = await params;
    const { request, recipients } = await getSignatureRequest(id);
    const mine = recipients.find((r) => r.recipientType === "PROFILE" && r.recipientId === profileId);
    if (!mine) throw new ApiError(404, "Signature request not found.");
    await markViewed(id, "PROFILE", profileId);
    return NextResponse.json({ request, myStatus: mine.status });
  } catch (error) {
    return handleApiError(error);
  }
}
