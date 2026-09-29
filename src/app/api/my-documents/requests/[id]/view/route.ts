import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { handleApiError } from "@/lib/route-guard";
import { markViewed } from "@/lib/documents/request-service";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const profileId = await requireApplicantProfileId();
    if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const { id } = await params;
    await markViewed(id, "PROFILE", profileId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
