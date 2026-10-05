import type { EngagementEventType, NotificationType } from "@prisma/client";

// STEP 30 — shared vocabulary for the engagement layer. Everything here is a CLOSED list: workflows, reminders and
// announcements can only ever use the values below, so a mis-typed or hostile definition cannot reach an action that
// is not on the list (no approvals, contact sharing, finalization, suspension, refunds or permission changes exist here).

export const ENGAGEMENT_FLAGS = {
  master: "engagement.enabled",
  events: "engagement.events.enabled",
  workflows: "engagement.workflows.enabled",
  reengagement: "engagement.reengagement.enabled",
  announcements: "engagement.announcements.enabled",
  feedback: "engagement.feedback.enabled",
  loyalty: "engagement.loyalty.enabled",
} as const;

export const ENGAGEMENT_EVENT_TYPES: EngagementEventType[] = [
  "USER_REGISTERED", "PROFILE_STARTED", "PROFILE_COMPLETED", "PROFILE_SUBMITTED", "VERIFICATION_STARTED", "VERIFICATION_COMPLETED",
  "PROFILE_ACTIVATED", "MATCH_AVAILABLE", "MATCH_REVIEW_REQUIRED", "PROPOSAL_RECEIVED", "PROPOSAL_SENT", "PROPOSAL_RESPONSE_PENDING",
  "PROPOSAL_RESPONSE_RECEIVED", "MUTUAL_INTEREST", "CONTACT_PERMISSION_PENDING", "CONTACT_APPROVED", "MEETING_REQUESTED",
  "MEETING_SCHEDULED", "MEETING_COMPLETED", "FOLLOWUP_DUE", "PROFILE_UPDATE_REQUESTED", "SUPPORT_CASE_CREATED", "MEMBERSHIP_STARTED",
  "MEMBERSHIP_EXPIRING", "SUBSCRIPTION_RENEWAL_DUE", "REFERRAL_CREATED", "REFERRAL_REWARDED", "INACTIVE_USER", "REENGAGEMENT_ELIGIBLE", "LOGIN",
];

// Events that happen at most once per applicant: the idempotency key carries no source, so a replay is a no-op.
export const ONCE_PER_PROFILE_EVENTS: EngagementEventType[] = [
  "USER_REGISTERED", "PROFILE_STARTED", "PROFILE_COMPLETED", "PROFILE_SUBMITTED", "VERIFICATION_STARTED", "VERIFICATION_COMPLETED", "PROFILE_ACTIVATED",
];

// Events that mean "the applicant themselves did something". Only these move last-activity forward and stop re-engagement:
// a system event (a proposal arriving, a membership nearing its end, an automated sweep) is not evidence of activity.
export const USER_ACTIVITY_EVENTS: EngagementEventType[] = [
  "USER_REGISTERED", "PROFILE_STARTED", "PROFILE_COMPLETED", "PROFILE_SUBMITTED", "VERIFICATION_STARTED", "VERIFICATION_COMPLETED",
  "PROPOSAL_RESPONSE_RECEIVED", "SUPPORT_CASE_CREATED", "MEMBERSHIP_STARTED", "REFERRAL_CREATED", "LOGIN",
];

// ---------- reminders ----------
export const REMINDER_KINDS = [
  "PROFILE_INCOMPLETE", "VERIFICATION_STALLED", "PROPOSAL_PENDING", "MEETING_UNCONFIRMED", "INACTIVITY", "MEMBERSHIP_EXPIRING", "FOLLOWUP_OVERDUE", "FEEDBACK_REQUEST",
] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

export const REMINDER_NOTIFICATION: Record<ReminderKind, NotificationType> = {
  PROFILE_INCOMPLETE: "ENGAGEMENT_PROFILE_REMINDER",
  VERIFICATION_STALLED: "ENGAGEMENT_VERIFICATION_REMINDER",
  PROPOSAL_PENDING: "ENGAGEMENT_PROPOSAL_REMINDER",
  MEETING_UNCONFIRMED: "ENGAGEMENT_MEETING_REMINDER",
  INACTIVITY: "ENGAGEMENT_REENGAGEMENT",
  MEMBERSHIP_EXPIRING: "ENGAGEMENT_MEMBERSHIP_REMINDER",
  FOLLOWUP_OVERDUE: "ENGAGEMENT_REENGAGEMENT",
  FEEDBACK_REQUEST: "ENGAGEMENT_FEEDBACK_REQUEST",
};

// Notification types a workflow step may send. Nothing else can be named, so a workflow can never send e.g. a security notice.
export const ENGAGEMENT_NOTIFICATION_TYPES: NotificationType[] = [
  "ENGAGEMENT_PROFILE_REMINDER", "ENGAGEMENT_VERIFICATION_REMINDER", "ENGAGEMENT_PROPOSAL_REMINDER", "ENGAGEMENT_MEETING_REMINDER",
  "ENGAGEMENT_MEMBERSHIP_REMINDER", "ENGAGEMENT_REENGAGEMENT", "ENGAGEMENT_ANNOUNCEMENT", "ENGAGEMENT_FEEDBACK_REQUEST",
];

// Re-engagement kinds are subject to the weekly re-engagement cap and the attempt cap, and are stopped by the applicant's
// "no re-engagement" switch. A feedback request is governed by its own switch.
export const REENGAGEMENT_KINDS: ReminderKind[] = ["PROFILE_INCOMPLETE", "VERIFICATION_STALLED", "PROPOSAL_PENDING", "MEETING_UNCONFIRMED", "INACTIVITY", "MEMBERSHIP_EXPIRING", "FOLLOWUP_OVERDUE"];

// The moment a reminder stops being needed. The applicant doing the thing cancels it immediately - they are never nagged
// after they have acted.
export const KIND_SATISFIED_BY: Record<ReminderKind, EngagementEventType[]> = {
  PROFILE_INCOMPLETE: ["PROFILE_COMPLETED", "PROFILE_SUBMITTED"],
  VERIFICATION_STALLED: ["VERIFICATION_COMPLETED"],
  PROPOSAL_PENDING: ["PROPOSAL_RESPONSE_RECEIVED"],
  MEETING_UNCONFIRMED: ["MEETING_SCHEDULED", "MEETING_COMPLETED"],
  INACTIVITY: ["LOGIN", "PROFILE_COMPLETED", "PROPOSAL_RESPONSE_RECEIVED", "SUPPORT_CASE_CREATED", "VERIFICATION_STARTED"],
  MEMBERSHIP_EXPIRING: ["MEMBERSHIP_STARTED"],
  FOLLOWUP_OVERDUE: ["LOGIN", "SUPPORT_CASE_CREATED"],
  FEEDBACK_REQUEST: [],
};

// ---------- workflow vocabulary ----------
// Task types a workflow may create: existing STEP 18 types only, all staff-review/follow-up work.
export const WORKFLOW_TASK_TYPES = [
  "NEW_PROFILE_REVIEW", "PROFILE_UPDATE_REVIEW", "VERIFICATION_REQUEST", "PROPOSAL_FOLLOWUP", "MEETING_FOLLOWUP", "SUPPORT_CASE_TASK", "FOLLOW_UP_DUE", "CRM_STAGE_STALL_REVIEW", "GENERAL_ADMIN_TASK",
] as const;

// Early, non-decision CRM stages only (forward-only is enforced by transitionStage itself).
export const WORKFLOW_SAFE_STAGES = ["PROFILE_INCOMPLETE", "PROFILE_SUBMITTED", "UNDER_REVIEW", "VERIFICATION_PENDING"] as const;

export const CONDITION_STAGES = [
  "REGISTERED", "PROFILE_INCOMPLETE", "PROFILE_SUBMITTED", "UNDER_REVIEW", "VERIFICATION_PENDING", "VERIFIED", "ACTIVE", "MATCHING", "PROPOSAL_ACTIVE",
  "WAITING_FOR_RESPONSE", "MUTUAL_INTEREST", "CONTACT_COORDINATION", "MEETING_SCHEDULED", "MEETING_COMPLETED", "FOLLOWUP", "FURTHER_DISCUSSION",
] as const;

export const MAX_WORKFLOW_STEPS = 8;
export const MAX_WAIT_HOURS = 24 * 30;
export const RUN_BATCH_SIZE = 200;
export const REMINDER_BATCH_SIZE = 200;

// Applicant-facing feedback choices after a meeting (never changes a proposal).
export const MEETING_FOLLOWUP_CHOICES = ["FURTHER_DISCUSSION", "NEED_MORE_INFORMATION", "NOT_INTERESTED", "CONTACT_ADMIN", "NO_DECISION_YET"] as const;
export type MeetingFollowupChoice = (typeof MEETING_FOLLOWUP_CHOICES)[number];

export const SURVEY_KINDS = ["SUPPORT_SATISFACTION", "ONBOARDING_SATISFACTION", "PLATFORM_USABILITY"] as const;

export const ANNOUNCEMENT_AUDIENCES = ["ALL", "NEW_USERS", "VERIFIED", "PACKAGE", "LIFECYCLE_STAGE"] as const;
export const GUIDE_CATEGORIES = ["getting-started", "profile", "verification", "matching", "proposals", "family", "meetings", "privacy", "safety", "membership", "support"] as const;

// Metrics written by the daily snapshot job (all counts; rates are derived with safeRate at read time).
export const SNAPSHOT_METRICS = [
  "REGISTERED", "PROFILE_STARTED", "PROFILE_COMPLETED", "PROFILE_SUBMITTED", "VERIFIED", "ACTIVATED", "PROPOSAL_RECEIVED", "PROPOSAL_RESPONDED",
  "MEETING_SCHEDULED", "MEETING_COMPLETED", "ACTIVE_USERS", "LOGINS", "REMINDERS_SENT", "REMINDERS_CANCELLED", "REENGAGEMENT_RESPONDED",
] as const;
