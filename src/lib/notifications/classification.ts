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

  // Case management (STEP 12) — essential. Support/complaint/safety-report
  // communication must never be silently dropped by a marketing-style
  // preference opt-out, matching ACCOUNT_SUSPENDED's treatment above.
  CASE_CREATED: ESSENTIAL,
  CASE_ASSIGNED: ESSENTIAL,
  CASE_REASSIGNED: ESSENTIAL,
  CASE_UPDATED: ESSENTIAL,
  CASE_COMMENT_ADDED: ESSENTIAL,
  INFORMATION_REQUESTED: ESSENTIAL,
  USER_RESPONDED: ESSENTIAL,
  CASE_ESCALATED: ESSENTIAL,
  CASE_OVERDUE: ESSENTIAL,
  CASE_RESOLVED: ESSENTIAL,
  CASE_CLOSED: ESSENTIAL,
  CASE_REOPENED: ESSENTIAL,
  ADMIN_PROFILE_RESTRICTED: ESSENTIAL,

  // Data Privacy, Consent, Account Management & Retention (STEP 13) —
  // essential. Account/deletion/export notices are account-security-adjacent,
  // matching ACCOUNT_SUSPENDED's treatment above.
  ACCOUNT_DEACTIVATED: ESSENTIAL,
  ACCOUNT_REACTIVATED: ESSENTIAL,
  DELETION_REQUEST_RECEIVED: ESSENTIAL,
  DELETION_COMPLETED: ESSENTIAL,
  DATA_EXPORT_READY: ESSENTIAL,
  PRIVACY_REQUEST_UPDATED: ESSENTIAL,

  // Payment, Subscription, Packages & Financial Management (STEP 14) —
  // essential. Payment/subscription/refund status must never be silently
  // dropped by a marketing-style preference opt-out.
  PAYMENT_SUCCESS: ESSENTIAL,
  PAYMENT_FAILED: ESSENTIAL,
  REFUND_REQUESTED: ESSENTIAL,
  REFUND_COMPLETED: ESSENTIAL,
  SUBSCRIPTION_STARTED: ESSENTIAL,
  SUBSCRIPTION_RENEWED: ESSENTIAL,
  SUBSCRIPTION_EXPIRING: ESSENTIAL,
  SUBSCRIPTION_CANCELLED: ESSENTIAL,
  INVOICE_CREATED: ESSENTIAL,
  MANUAL_PAYMENT_REQUIRES_REVIEW: ESSENTIAL,

  // Workflow & Task Management (STEP 18) — essential. Internal-only,
  // admin-facing (notifyAdmins() sends in-app only, no external dispatch, no
  // preference/consent check either way — see notification-service.ts), but
  // classified essential for consistency with every other admin-only type above.
  TASK_ASSIGNED: ESSENTIAL,
  TASK_REASSIGNED: ESSENTIAL,
  TASK_DUE_SOON: ESSENTIAL,
  TASK_OVERDUE: ESSENTIAL,
  TASK_ESCALATED: ESSENTIAL,
  TASK_COMMENT_MENTION: ESSENTIAL,
  TASK_DEPENDENCY_COMPLETED: ESSENTIAL,
  TASK_REOPENED: ESSENTIAL,

  // Approval Governance (STEP 19) — essential, same internal-only convention.
  APPROVAL_REQUESTED: ESSENTIAL,
  APPROVAL_ASSIGNED: ESSENTIAL,
  APPROVAL_APPROVED: ESSENTIAL,
  APPROVAL_REJECTED: ESSENTIAL,
  APPROVAL_CHANGES_REQUESTED: ESSENTIAL,
  APPROVAL_EXPIRING: ESSENTIAL,
  APPROVAL_EXPIRED: ESSENTIAL,
  APPROVAL_EXECUTION_STARTED: ESSENTIAL,
  APPROVAL_EXECUTED: ESSENTIAL,
  APPROVAL_EXECUTION_FAILED: ESSENTIAL,
  EMERGENCY_OVERRIDE_USED: ESSENTIAL,

  // Family/Guardian Portal (STEP 22) — essential. Invitation/access/decision
  // notices are security- and consent-adjacent (who can see this applicant's
  // data), matching CONTACT_PERMISSION_*'s treatment above; there is no
  // dedicated FAMILY PreferenceCategory in this pass (disclosed — a future
  // step could add one if a granular opt-out is ever requested).
  FAMILY_INVITATION: ESSENTIAL,
  FAMILY_ACCESS_GRANTED: ESSENTIAL,
  FAMILY_ACCESS_REVOKED: ESSENTIAL,
  FAMILY_ACCESS_REQUEST: ESSENTIAL,
  FAMILY_PROPOSAL_SHARED: ESSENTIAL,
  FAMILY_PROPOSAL_UPDATED: ESSENTIAL,
  FAMILY_DECISION_REQUESTED: ESSENTIAL,
  FAMILY_MEETING_UPDATED: ESSENTIAL,
  FAMILY_PERMISSION_EXPIRING: ESSENTIAL,
  FAMILY_PERMISSION_EXPIRED: ESSENTIAL,

  // STEP 23 — KYC, Identity Verification, Duplicate Detection & Safety
  // Intelligence. ADMIN_* types are internal-only, same convention as every
  // other admin-only type above; the two applicant-facing KYC_* types are
  // security/account-integrity notices, essential like VERIFICATION_* above.
  ADMIN_HIGH_RISK_SIGNAL: ESSENTIAL,
  ADMIN_REVERIFICATION_DUE: ESSENTIAL,
  PROVIDER_VERIFICATION_FAILURE: ESSENTIAL,
  KYC_VERIFICATION_REQUIRES_ACTION: ESSENTIAL,
  KYC_VERIFICATION_COMPLETED: ESSENTIAL,

  // STEP 23 Add-on — Legal Jurisdiction Safeguards & Regulatory Compliance
  // Framework. All admin-internal (compliance/legal ops), same convention as
  // ADMIN_* above — essential, not subject to applicant notification preferences.
  COMPLIANCE_RULE_EXPIRING: ESSENTIAL,
  COMPLIANCE_RULE_EXPIRED: ESSENTIAL,
  COMPLIANCE_JURISDICTION_UNKNOWN: ESSENTIAL,
  COMPLIANCE_TRANSFER_REVIEW_REQUIRED: ESSENTIAL,
  COMPLIANCE_PROVIDER_REVIEW_DUE: ESSENTIAL,
  COMPLIANCE_LEGAL_HOLD_ACTIVE: ESSENTIAL,
  COMPLIANCE_POLICY_CONFLICT: ESSENTIAL,
  COMPLIANCE_AUTHORITY_REQUEST_DUE: ESSENTIAL,

  // STEP 24 — Fraud Prevention & Account Safety Intelligence. Admin-internal
  // types follow the ADMIN_* convention above; the three applicant-facing
  // types are security/account-integrity notices, essential like
  // KYC_VERIFICATION_REQUIRES_ACTION, and worded neutrally by design.
  HIGH_RISK_DETECTED: ESSENTIAL,
  CRITICAL_RISK_DETECTED: ESSENTIAL,
  DUPLICATE_REVIEW_REQUIRED: ESSENTIAL,
  VERIFICATION_RISK: ESSENTIAL,
  ACCOUNT_SECURITY_ALERT: ESSENTIAL,
  CONTACT_BYPASS_DETECTED: ESSENTIAL,
  ADMIN_ACCESS_ANOMALY: ESSENTIAL,
  SAFETY_REPORT_RECEIVED: ESSENTIAL,
  RISK_REVIEW_DUE: ESSENTIAL,
  RISK_CASE_ESCALATED: ESSENTIAL,
  RISK_INFORMATION_REQUESTED: ESSENTIAL,
  SECURITY_NOTICE: ESSENTIAL,
  SAFETY_REPORT_ACKNOWLEDGED: ESSENTIAL,
  // STEP 25 - admin-only operational alerts
  COMMUNICATION_PROVIDER_ALERT: ESSENTIAL,
  COMMUNICATION_REVIEW_REQUIRED: ESSENTIAL,

  // STEP 26 - document management. Action-required / decision notices are essential (mirrors
  // VERIFICATION_ACTION_REQUIRED/RE_VERIFICATION_REQUIRED above); only the expiry reminder is a
  // gated, non-essential follow-up.
  DOCUMENT_REQUESTED: ESSENTIAL,
  DOCUMENT_REVIEW_DECIDED: ESSENTIAL,
  DOCUMENT_EXPIRING_SOON: FOLLOWUP,
  DOCUMENT_REVERIFICATION_REQUIRED: ESSENTIAL,
  DOCUMENT_SHARE_REQUEST: ESSENTIAL,
  DOCUMENT_SIGNATURE_REQUEST: ESSENTIAL,
  ADMIN_DOCUMENT_REVIEW_QUEUE: ESSENTIAL,
  ADMIN_DOCUMENT_SECURITY_ALERT: ESSENTIAL,

  // STEP 27 — Membership, Packages, Entitlements, Coupons & Referrals —
  // essential, matching STEP 14's payment/subscription treatment above.
  TRIAL_STARTED: ESSENTIAL,
  TRIAL_ENDING: FOLLOWUP,
  PACKAGE_CHANGED: ESSENTIAL,
  COUPON_APPLIED: ESSENTIAL,
  COUPON_EXPIRED: FOLLOWUP,
  REFERRAL_REWARD_GRANTED: ESSENTIAL,
  ENTITLEMENT_EXPIRED: ESSENTIAL,
  ADMIN_REFERRAL_REVIEW_REQUIRED: ESSENTIAL,

  // STEP 30 — engagement reminders/announcements. All are preference-gated (FOLLOWUP category, never ESSENTIAL): an
  // applicant can switch them off, and the engagement preflight additionally enforces suppression, frequency and quiet hours.
  ENGAGEMENT_PROFILE_REMINDER: FOLLOWUP,
  ENGAGEMENT_VERIFICATION_REMINDER: FOLLOWUP,
  ENGAGEMENT_PROPOSAL_REMINDER: FOLLOWUP,
  ENGAGEMENT_MEETING_REMINDER: FOLLOWUP,
  ENGAGEMENT_MEMBERSHIP_REMINDER: FOLLOWUP,
  ENGAGEMENT_REENGAGEMENT: FOLLOWUP,
  ENGAGEMENT_ANNOUNCEMENT: FOLLOWUP,
  ENGAGEMENT_FEEDBACK_REQUEST: FOLLOWUP,

  // STEP 28 — CRM, Applicant Lifecycle & Lead Management — admin-only,
  // internal (assignment/SLA notices via notifyAdmins), never sent to a profile.
  CRM_FOLLOWUP_DUE: ESSENTIAL,
  CRM_FOLLOWUP_OVERDUE: ESSENTIAL,
  CRM_STAGE_CHANGED: ESSENTIAL,
  CRM_ASSIGNED_TO_YOU: ESSENTIAL,
  CRM_SLA_ESCALATED: ESSENTIAL,
  LEAD_ASSIGNED_TO_YOU: ESSENTIAL,
  // STEP 31 — admin-only, in-app (never sent to an applicant)
  ANALYTICS_ALERT: ESSENTIAL,
  ANALYTICS_REPORT_READY: ESSENTIAL,
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
