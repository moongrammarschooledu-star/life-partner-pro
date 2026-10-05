import type { CrmLifecycleStage, ProfileStatus, SubscriptionStatus, VerificationStatus } from "@prisma/client";
import type { Lang } from "@/lib/engagement/phrases";

// The read model every pure engagement function works on: plain facts about one applicant's platform state, loaded once by
// read-model.ts. It deliberately carries NO contact details, documents, notes, risk signals, scores or protected attributes,
// so nothing derived from it (journey, next actions, reminders, AI summaries) can leak or discriminate on them.
export interface EngagementSnapshot {
  now: Date;
  language: Lang;
  profile: { status: ProfileStatus; verified: boolean; completion: number; createdAt: Date; softDeleted: boolean };
  // plain category labels that still have empty fields (e.g. "Education", "Family")
  missingSections: string[];
  hasPhoto: boolean;
  hasPartnerRequirements: boolean;
  verification: { status: VerificationStatus; requestedInfoCount: number };
  proposals: { total: number; awaitingMyResponse: number; responded: number; received: number };
  meetings: { awaitingConfirmation: number; scheduled: number; completed: number; completedAwaitingFollowup: number };
  membership: { status: SubscriptionStatus | null; endsAt: Date | null };
  openCases: number;
  hasNotificationPreferences: boolean;
  lastActivityAt: Date | null;
  crmStage: CrmLifecycleStage | null;
  // support-case / feedback interactions in the last 90 days (counts only)
  recentSupportInteractions: number;
  completedTasksRatio: number | null;
}

export type JourneyStageState = "COMPLETED" | "IN_PROGRESS" | "NOT_STARTED";

export interface JourneyStage {
  key: "REGISTRATION" | "PROFILE" | "VERIFICATION" | "MATCHING" | "PROPOSAL" | "MEETING" | "FOLLOW_UP";
  state: JourneyStageState;
  label: string;
  stateLabel: string;
}

export interface Journey {
  stages: JourneyStage[];
  note: string | null;
  disclaimer: string;
}

export interface NextAction {
  key: string;
  title: string;
  reason: string;
  href: string;
  // 1 = first in the list. This is ordering, never urgency: nothing is labelled urgent or time-limited.
  order: number;
}
