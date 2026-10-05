import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { handleApiError } from "@/lib/route-guard";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { HttpError } from "@/lib/http-error";
import { submitMeetingFollowup } from "@/lib/engagement/feedback-service";

// The applicant's own answer after a meeting. It creates a staff follow-up task and an engagement event; it never changes the
// proposal, the profile or any status.
export async function POST(req: Request) {
  try {
    const profileId = await requireApplicantProfileId();
    if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const limited = await enforceConfiguredLimit(req, "engagement-feedback", { limit: 5, windowMs: 3_600_000 });
    if (limited) return limited;
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, "Invalid request body.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Invalid request body.");
    const out = await submitMeetingFollowup(profileId, body as Record<string, unknown>);
    return NextResponse.json({ ok: true, reference: out.code }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
