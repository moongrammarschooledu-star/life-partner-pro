import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { handleApiError } from "@/lib/route-guard";
import { feedbackEnabled, listPublishedSurveys } from "@/lib/engagement/feedback-service";

export async function GET() {
  try {
    const profileId = await requireApplicantProfileId();
    if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    if (!(await feedbackEnabled())) return NextResponse.json({ enabled: false, items: [] });
    return NextResponse.json({ enabled: true, items: await listPublishedSurveys() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}
