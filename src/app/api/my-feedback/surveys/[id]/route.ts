import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { handleApiError } from "@/lib/route-guard";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { HttpError } from "@/lib/http-error";
import { submitSurveyResponse } from "@/lib/engagement/feedback-service";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const profileId = await requireApplicantProfileId();
    if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const limited = await enforceConfiguredLimit(req, "engagement-feedback", { limit: 5, windowMs: 3_600_000 });
    if (limited) return limited;
    const { id } = await params;
    let body: { answers?: unknown; refKey?: unknown };
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, "Invalid request body.");
    }
    return NextResponse.json(await submitSurveyResponse(profileId, id, body?.answers, typeof body?.refKey === "string" ? body.refKey : ""), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
