import type { NotificationType } from "@prisma/client";

export type PreferenceCategory = "PROPOSAL" | "MEETING" | "FOLLOWUP" | "MARKETING" | null;

export interface NotificationClassification {
  // Essential types are always attempted on Email/In-App regardless of
  // NotificationPreference/CommunicationConsent (spec §25 — "essential
  // account/security notifications may still be sent"). Non-essential types
  // respect both preference (this category) and consent for every external
  // channel.
  essential: boolean;
  preferenceCategory: PreferenceCategory;
}

const ESSENTIAL: NotificationClassification = { essential: true, preferenceCategory: null };
const PROPOSAL: NotificationClassification = { essential: false, preferenceCategory: "PROPOSAL" };
const MEETING: NotificationClassification = { essential: false, preferenceCategory: "MEETING" };
const FOLLOWUP: NotificationClassification = { essential: false, preferenceCategory: "FOLLOWUP" };

// One row per NotificationType — reviewable at a glance rather than inline
// conditionals scattered through dispatch.ts (plan decision 3).
export const NOTIFICATION_CLASSIFICATION: Record<NotificationType, NotificationClassification> = {
  // Account — essential
  ACCOUNT_REGISTERED: ESSENTIAL,
  MOBILE_VERIFIED: ESSENTIAL,
  EMAIL_VERIFIED: ESSENTIAL,
  PROFILE_SUBMITTED: ESSENTIAL,
  PROFILE_APPROVED: ESSENTIAL,
  PROFILE_UPDATE_APPROVED: ESSENTIAL,
  PROFILE_UPDATE_REJECTED: ESSENTIAL,
  ACCOUNT_SUSPENDED: ESSENTIAL,

  // Verification — essential
  VERIFICATION_STARTED: ESSENTIAL,
  VERIFICATION_APPROVED: ESSENTIAL,
  VERIFICATION_ACTION_REQUIRED: ESSENTIAL,
  VERIFICATION_REJECTED: ESSENTIAL,
  RE_VERIFICATION_REQUIRED: ESSENTIAL,

  // Matching — essential (never reveals the other profile anyway)
  MATCH_IDENTIFIED: ESSENTIAL,

  // Proposal — non-essential, gated by preference/consent
  PROPOSAL_RECEIVED: PROPOSAL,
  PROPOSAL_VIEWED: PROPOSAL,
  PROPOSAL_INTEREST_SUBMITTED: PROPOSAL,
  PROPOSAL_NOT_INTERESTED: PROPOSAL,
  PROPOSAL_MUTUAL_INTEREST: PROPOSAL,
  PROPOSAL_ADMIN_ACTION_REQUIRED: PROPOSAL,
  PROPOSAL_STATUS_CHANGED: PROPOSAL,
  PROPOSAL_PENDING_REMINDER: PROPOSAL,
  PROPOSAL_FINALIZED: PROPOSAL,

  // Contact — essential (consent/approval-flow integrity matters more than opt-out)
  CONTACT_PERMISSION_REQUESTED: ESSENTIAL,
  CONTACT_PERMISSION_APPROVED: ESSENTIAL,
  CONTACT_PERMISSION_REVOKED: ESSENTIAL,

  // Meeting — non-essential, gated by preference/consent
  MEETING_REQUESTED: MEETING,
  MEETING_SCHEDULED: MEETING,
  MEETING_CONFIRMED: MEETING,
  MEETING_RESCHEDULED: MEETING,
  MEETING_CANCELLED: MEETING,
  MEETING_COMPLETED: MEETING,
  MEETING_REMINDER_24H: MEETING,
  MEETING_REMINDER_2H: MEETING,

  // Follow-up — non-essential
  FOLLOWUP_REMINDER: FOLLOWUP,
  FOLLOWUP_ADMIN_RESPONSE_REQUESTED: FOLLOWUP,

  // Admin-only — essential (always in-app to the admin; never dispatched externally to a profile)
  ADMIN_MUTUAL_INTEREST: ESSENTIAL,
  ADMIN_CONTACT_PERMISSION_REQUEST: ESSENTIAL,
  ADMIN_MEETING_REQUEST: ESSENTIAL,
  ADMIN_MEETING_CONFIRMATION: ESSENTIAL,
  ADMIN_OVERDUE_FOLLOWUP: ESSENTIAL,
  ADMIN_SUSPICIOUS_ACTIVITY: ESSENTIAL,
  ADMIN_DUPLICATE_PROFILE_ALERT: ESSENTIAL,
  ADMIN_PROFILE_UPDATE_PENDING: ESSENTIAL,
  ADMIN_ASSIGNMENT_CHANGED: ESSENTIAL,

  // Admin-composed manual message — essential (an admin explicitly chose to send it)
  ADMIN_DIRECT_MESSAGE: ESSENTIAL,

  // Test mode — essential (bypasses preference/consent by design; it's admin-triggered)
  TEST_NOTIFICATION: ESSENTIAL,
};

export function classify(type: NotificationType): NotificationClassification {
  return NOTIFICATION_CLASSIFICATION[type];
}

// Pure decision function — given already-fetched primitives (no I/O here),
// should this external channel actually be attempted for this notification?
// Essential types bypass preference + consent but still respect the
// platform-level AppSettings enabled toggle (spec §25).
export function shouldAttemptExternalChannel(params: {
  type: NotificationType;
  channelEnabledInSettings: boolean;
  preferenceValue: boolean | null; // null = no NotificationPreference row yet -> schema defaults apply
  consentStatus: "GRANTED" | "REVOKED" | null; // null = no CommunicationConsent row yet -> treated as granted
}): boolean {
  if (!params.channelEnabledInSettings) return false;

  const { essential, preferenceCategory } = classify(params.type);
  if (essential) return true;

  if (preferenceCategory) {
    const schemaDefault = preferenceCategory !== "MARKETING";
    const allowed = params.preferenceValue ?? schemaDefault;
    if (!allowed) return false;
  }

  if (params.consentStatus === "REVOKED") return false;
  return true;
}
