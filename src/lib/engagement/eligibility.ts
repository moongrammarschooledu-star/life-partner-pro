import { daysSince } from "@/lib/engagement/activity-score";
import type { ReminderKind } from "@/lib/engagement/constants";
import type { WorkflowConditions } from "@/lib/engagement/workflow-schema";
import type { EngagementSnapshot } from "@/lib/engagement/types";

// STEP 30 — pure eligibility rules. Two questions, both answered from the snapshot only:
//   stillNeeded(kind)       - is the thing this reminder asks for STILL open? (if not, the reminder is cancelled, never sent)
//   conditionsMatch(cond)   - does the applicant match the workflow's conditions right now?
// Neither can read a score, a risk signal or a protected attribute: the snapshot does not contain them.

export interface EligibilityThresholds {
  inactiveAfterDays: number;
  membershipWindowDays: number;
}

export const DEFAULT_THRESHOLDS: EligibilityThresholds = { inactiveAfterDays: 30, membershipWindowDays: 14 };

export function stillNeeded(kind: ReminderKind, s: EngagementSnapshot, t: EligibilityThresholds = DEFAULT_THRESHOLDS): boolean {
  switch (kind) {
    case "PROFILE_INCOMPLETE":
      return s.profile.completion < 100;
    case "VERIFICATION_STALLED":
      return !s.profile.verified && ["VERIFICATION_PENDING", "VERIFICATION_REQUIRED", "RE_VERIFICATION_REQUIRED"].includes(s.verification.status);
    case "PROPOSAL_PENDING":
      return s.proposals.awaitingMyResponse > 0;
    case "MEETING_UNCONFIRMED":
      return s.meetings.awaitingConfirmation > 0;
    case "INACTIVITY": {
      const idle = daysSince(s.lastActivityAt, s.now);
      return idle !== null && idle >= t.inactiveAfterDays;
    }
    case "MEMBERSHIP_EXPIRING": {
      if (!s.membership.endsAt || !s.membership.status || !["ACTIVE", "TRIAL"].includes(s.membership.status)) return false;
      const ahead = (s.membership.endsAt.getTime() - s.now.getTime()) / 86_400_000;
      return ahead >= 0 && ahead <= t.membershipWindowDays;
    }
    case "FOLLOWUP_OVERDUE":
      return s.meetings.completedAwaitingFollowup > 0;
    case "FEEDBACK_REQUEST":
      return true;
  }
}

export function conditionsMatch(c: WorkflowConditions, s: EngagementSnapshot): { match: boolean; failed?: string } {
  const fail = (why: string) => ({ match: false, failed: why });
  if (c.stageIn && (!s.crmStage || !c.stageIn.includes(s.crmStage as (typeof c.stageIn)[number]))) return fail("STAGE");
  if (c.completionLt !== undefined && !(s.profile.completion < c.completionLt)) return fail("COMPLETION_LT");
  if (c.completionGte !== undefined && !(s.profile.completion >= c.completionGte)) return fail("COMPLETION_GTE");
  if (c.verificationNotComplete !== undefined && c.verificationNotComplete === (s.profile.verified || s.verification.status === "VERIFIED")) return fail("VERIFICATION");
  if (c.hasOpenProposal !== undefined && c.hasOpenProposal !== s.proposals.awaitingMyResponse > 0) return fail("OPEN_PROPOSAL");
  if (c.inactiveDaysGte !== undefined) {
    const idle = daysSince(s.lastActivityAt, s.now);
    if (idle === null || idle < c.inactiveDaysGte) return fail("INACTIVE_DAYS");
  }
  if (c.membershipActive !== undefined && c.membershipActive !== (!!s.membership.status && ["ACTIVE", "TRIAL"].includes(s.membership.status))) return fail("MEMBERSHIP");
  if (c.language && c.language !== s.language) return fail("LANGUAGE");
  return { match: true };
}

// Profile states in which NO engagement message is ever sent: the account is closed, restricted, paused by the applicant/team,
// or finished. (The reason for a restriction is never part of any message.)
export const NO_CONTACT_PROFILE_STATUSES = ["SUSPENDED", "ARCHIVED", "REJECTED", "MARRIED", "FINALIZED", "NOT_INTERESTED"];

export function profileMayReceiveEngagement(s: EngagementSnapshot): { ok: boolean; reason?: string } {
  if (s.profile.softDeleted) return { ok: false, reason: "PROFILE_DELETED" };
  if (NO_CONTACT_PROFILE_STATUSES.includes(s.profile.status)) return { ok: false, reason: "PROFILE_STATUS" };
  return { ok: true };
}
