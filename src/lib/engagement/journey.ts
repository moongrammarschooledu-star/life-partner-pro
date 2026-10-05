import { JOURNEY_DISCLAIMER, JOURNEY_LABELS, JOURNEY_NOTE, type Lang } from "@/lib/engagement/phrases";
import type { EngagementSnapshot, Journey, JourneyStage, JourneyStageState } from "@/lib/engagement/types";

// STEP 30 — user journey (pure). A neutral progress view of the applicant's own steps. It shows what has been done, what is
// in progress and what has not started; it never shows a future stage as expected, never ranks the applicant and never
// implies an outcome. Closed or restricted accounts get a plain, non-specific note (never the reason for a restriction).

const PAUSED = ["ON_HOLD", "NOT_INTERESTED", "ARCHIVED"];
const RESTRICTED = ["SUSPENDED", "REJECTED"];
const CLOSED = ["MARRIED", "FINALIZED"];
const VERIFICATION_IN_PROGRESS = ["VERIFICATION_PENDING", "UNDER_REVIEW", "VERIFICATION_REQUIRED", "RE_VERIFICATION_REQUIRED"];

export function computeJourney(s: EngagementSnapshot): Journey {
  const lang: Lang = s.language;
  const labels = JOURNEY_LABELS[lang];
  const stage = (key: JourneyStage["key"], state: JourneyStageState): JourneyStage => ({ key, state, label: labels[key], stateLabel: labels[state] });

  const profileState: JourneyStageState = s.profile.completion >= 100 ? "COMPLETED" : "IN_PROGRESS";
  const verificationState: JourneyStageState = s.profile.verified || s.verification.status === "VERIFIED" ? "COMPLETED" : VERIFICATION_IN_PROGRESS.includes(s.verification.status) ? "IN_PROGRESS" : "NOT_STARTED";
  const matchingState: JourneyStageState = s.proposals.total > 0 ? "COMPLETED" : ["ACTIVE", "MATCHING"].includes(s.profile.status) ? "IN_PROGRESS" : "NOT_STARTED";
  const proposalState: JourneyStageState = s.proposals.awaitingMyResponse > 0 ? "IN_PROGRESS" : s.proposals.total > 0 ? "COMPLETED" : "NOT_STARTED";
  const meetingState: JourneyStageState = s.meetings.awaitingConfirmation + s.meetings.scheduled > 0 ? "IN_PROGRESS" : s.meetings.completed > 0 ? "COMPLETED" : "NOT_STARTED";
  const followUpState: JourneyStageState = s.meetings.completedAwaitingFollowup > 0 ? "IN_PROGRESS" : "NOT_STARTED";

  const note = s.profile.softDeleted || PAUSED.includes(s.profile.status) ? JOURNEY_NOTE[lang].paused : RESTRICTED.includes(s.profile.status) ? JOURNEY_NOTE[lang].restricted : CLOSED.includes(s.profile.status) ? JOURNEY_NOTE[lang].closed : null;

  return {
    stages: [
      stage("REGISTRATION", "COMPLETED"),
      stage("PROFILE", profileState),
      stage("VERIFICATION", verificationState),
      stage("MATCHING", matchingState),
      stage("PROPOSAL", proposalState),
      stage("MEETING", meetingState),
      stage("FOLLOW_UP", followUpState),
    ],
    note,
    disclaimer: JOURNEY_DISCLAIMER[lang],
  };
}
