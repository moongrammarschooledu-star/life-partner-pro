import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { handleApiError } from "@/lib/route-guard";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { getEngagementPreference, getEngagementSettings, updateEngagementPreference } from "@/lib/engagement/settings";
import { HttpError } from "@/lib/http-error";

// Reminder / re-engagement / feedback switches, quiet hours, time zone and a personal daily cap. Channel switches and consent live in
// /api/my-notifications/preferences (unchanged). Switching reminders or re-engagement off stops pending ones immediately.
export async function GET() {
  try {
    const profileId = await requireApplicantProfileId();
    if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const [pref, settings] = await Promise.all([getEngagementPreference(profileId), getEngagementSettings()]);
    return NextResponse.json({
      preferences: pref ? { quietHoursEnabled: pref.quietHoursEnabled, quietHoursStart: pref.quietHoursStart, quietHoursEnd: pref.quietHoursEnd, timezone: pref.timezone, maxDailyNotifications: pref.maxDailyNotifications, remindersEnabled: pref.remindersEnabled, reengagementEnabled: pref.reengagementEnabled, feedbackRequestsEnabled: pref.feedbackRequestsEnabled }
        : { quietHoursEnabled: false, quietHoursStart: null, quietHoursEnd: null, timezone: null, maxDailyNotifications: null, remindersEnabled: true, reengagementEnabled: true, feedbackRequestsEnabled: true },
      defaults: { quietHoursStart: settings.quietHoursStart, quietHoursEnd: settings.quietHoursEnd, timezone: settings.defaultTimezone, maxDailyNotifications: settings.maxDailyNotifications },
      note: "Security, verification and account notices are not affected by these switches.",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: Request) {
  try {
    const profileId = await requireApplicantProfileId();
    if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const limited = await enforceConfiguredLimit(req, "engagement-preferences", { limit: 30, windowMs: 3_600_000 });
    if (limited) return limited;
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, "Invalid request body.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Invalid request body.");
    const row = await updateEngagementPreference(profileId, body as Record<string, unknown>);
    return NextResponse.json({ ok: true, remindersEnabled: row.remindersEnabled, reengagementEnabled: row.reengagementEnabled });
  } catch (error) {
    return handleApiError(error);
  }
}
