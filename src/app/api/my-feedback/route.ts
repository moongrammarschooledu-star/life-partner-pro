import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { handleApiError } from "@/lib/route-guard";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { HttpError } from "@/lib/http-error";
import { feedbackEnabled, listMeetingsAwaitingFollowup, listMyFeedback, submitFeedback, FEEDBACK_CHOICE_LABELS } from "@/lib/engagement/feedback-service";
import { MEETING_FOLLOWUP_CHOICES } from "@/lib/engagement/constants";

// The applicant's own feedback. The profile comes from the session; the response never contains staff notes.
export async function GET() {
  try {
    const profileId = await requireApplicantProfileId();
    if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const enabled = await feedbackEnabled();
    if (!enabled) return NextResponse.json({ enabled: false, items: [], meetings: [], choices: [] });
    const [items, meetings] = await Promise.all([listMyFeedback(profileId), listMeetingsAwaitingFollowup(profileId)]);
    return NextResponse.json({ enabled: true, items, meetings, choices: MEETING_FOLLOWUP_CHOICES.map((c) => ({ key: c, ...FEEDBACK_CHOICE_LABELS[c] })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}

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
    const out = await submitFeedback(profileId, body as Record<string, unknown>);
    return NextResponse.json({ ok: true, reference: out.code }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
