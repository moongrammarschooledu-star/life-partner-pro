import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { handleApiError } from "@/lib/route-guard";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { ENGAGEMENT_FLAGS } from "@/lib/engagement/constants";
import { loadEngagementSnapshot } from "@/lib/engagement/read-model";
import { computeJourney } from "@/lib/engagement/journey";
import { computeNextActions, nextActionDisclaimer } from "@/lib/engagement/next-action";
import { listActiveAnnouncementsFor } from "@/lib/engagement/announcement-service";
import { feedbackEnabled, listMeetingsAwaitingFollowup } from "@/lib/engagement/feedback-service";

// The applicant's own journey and suggested next steps. The profile always comes from the signed-in session, never from the
// request. The internal activity score is NEVER returned here: it is staff-only and is not a measure of the applicant.
export async function GET() {
  try {
    const profileId = await requireApplicantProfileId();
    if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    if (!(await isFeatureEnabled(ENGAGEMENT_FLAGS.master))) return NextResponse.json({ enabled: false }, { headers: { "Cache-Control": "no-store" } });
    const snapshot = await loadEngagementSnapshot(profileId);
    if (!snapshot) return NextResponse.json({ error: "Profile not found." }, { status: 404 });
    const [announcements, meetings, feedbackOn] = await Promise.all([listActiveAnnouncementsFor(profileId), listMeetingsAwaitingFollowup(profileId), feedbackEnabled()]);
    return NextResponse.json({
      enabled: true,
      language: snapshot.language,
      journey: computeJourney(snapshot),
      nextActions: computeNextActions(snapshot),
      disclaimer: nextActionDisclaimer(snapshot.language),
      announcements,
      meetingFollowups: feedbackOn ? meetings : [],
      feedbackEnabled: feedbackOn,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}
