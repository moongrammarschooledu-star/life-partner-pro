import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/route-guard";
import { assertProfileAssignmentAccess } from "@/lib/profile-assignment-access";
import { loadEngagementSnapshot } from "@/lib/engagement/read-model";
import { computeJourney } from "@/lib/engagement/journey";
import { computeNextActions } from "@/lib/engagement/next-action";
import { ACTIVITY_SCORE_NOTE, computeActivityScore } from "@/lib/engagement/activity-score";
import { getEngagementPreference } from "@/lib/engagement/settings";
import { marketingError, noStore } from "@/lib/marketing/route-utils";

// One applicant's engagement view for staff: journey, next actions, activity band/score (admin-only, never a quality measure),
// recent engagement events, reminders and preference summary. Access follows the same profile-assignment rule as other staff
// profile screens. No contact details, documents or notes are returned.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("engagement:events:view");
    const { id } = await params;
    await assertProfileAssignmentAccess(admin, id);
    const snapshot = await loadEngagementSnapshot(id);
    if (!snapshot) return NextResponse.json({ error: "Profile not found." }, { status: 404, headers: noStore });
    const [profile, state, events, reminders, pref, feedbackCount] = await Promise.all([
      prisma.profile.findUnique({ where: { id }, select: { id: true, profileCode: true, status: true } }),
      prisma.engagementProfileState.findUnique({ where: { profileId: id } }),
      prisma.engagementEvent.findMany({ where: { profileId: id }, orderBy: { occurredAt: "desc" }, take: 100, select: { id: true, type: true, refType: true, occurredAt: true } }),
      prisma.engagementReminder.findMany({ where: { profileId: id }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, kind: true, state: true, dueAt: true, sentAt: true, attempt: true, cancelReason: true } }),
      getEngagementPreference(id),
      prisma.engagementFeedback.count({ where: { profileId: id } }),
    ]);
    return NextResponse.json({
      profile,
      journey: computeJourney(snapshot),
      nextActions: computeNextActions(snapshot),
      activity: { state: state?.activityState ?? null, lastActivityAt: state?.lastActivityAt ?? null, reengagementAttempts: state?.reengagementAttempts ?? 0, optedOut: state?.reengagementOptOut ?? false, score: computeActivityScore(snapshot), scoreNote: ACTIVITY_SCORE_NOTE },
      events, reminders,
      preferences: pref ? { remindersEnabled: pref.remindersEnabled, reengagementEnabled: pref.reengagementEnabled, feedbackRequestsEnabled: pref.feedbackRequestsEnabled, quietHoursStart: pref.quietHoursStart, quietHoursEnd: pref.quietHoursEnd, timezone: pref.timezone } : null,
      feedbackCount,
    }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}
