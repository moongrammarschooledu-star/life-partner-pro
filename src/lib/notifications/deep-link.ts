import type { NotificationType } from "@prisma/client";

// Every target path below is an existing cookie-session (public) or
// NextAuth-session (admin) gated page that already re-derives identity
// server-side — a notification link is never itself treated as proof of
// permission (spec §22). Pure — no I/O.
export function buildActionUrl(
  recipientKind: "PROFILE" | "ADMIN" | "FAMILY",
  type: NotificationType,
  ids: { proposalId?: string; profileId?: string }
): string | undefined {
  if (recipientKind === "FAMILY") {
    if (type.startsWith("FAMILY_PROPOSAL") || type === "FAMILY_DECISION_REQUESTED") return "/family/proposals";
    if (type === "FAMILY_MEETING_UPDATED") return "/family/meetings";
    if (type.startsWith("FAMILY_ACCESS") || type.startsWith("FAMILY_PERMISSION") || type === "FAMILY_INVITATION") return "/family/dashboard";
    return "/family/dashboard";
  }

  if (recipientKind === "PROFILE") {
    if (type.startsWith("PROPOSAL_") || type.startsWith("CONTACT_") || type.startsWith("MEETING_") || type === "PROPOSAL_MUTUAL_INTEREST") {
      return "/my-proposals";
    }
    if (type.startsWith("VERIFICATION_") || type === "RE_VERIFICATION_REQUIRED" || type === "MOBILE_VERIFIED" || type === "EMAIL_VERIFIED") {
      return "/my-verification";
    }
    if (type.startsWith("FOLLOWUP_")) {
      return "/my-status";
    }
    // STEP 24 — neutral applicant notices: where they can act, never anything about why.
    if (type === "RISK_INFORMATION_REQUESTED") return "/my-verification";
    if (type === "SAFETY_REPORT_ACKNOWLEDGED") return "/report-concern";
    // STEP 26 — document management
    if (type.startsWith("DOCUMENT_")) return "/dashboard/documents";
    // STEP 27 — membership/entitlements/coupons/referrals
    if (type === "REFERRAL_REWARD_GRANTED") return "/dashboard/referrals";
    if (["TRIAL_STARTED", "TRIAL_ENDING", "PACKAGE_CHANGED", "COUPON_APPLIED", "COUPON_EXPIRED", "ENTITLEMENT_EXPIRED"].includes(type)) return "/dashboard/membership";
    return "/my-notifications";
  }

  // ADMIN
  if (ids.proposalId && (type.startsWith("ADMIN_MUTUAL") || type.startsWith("ADMIN_CONTACT") || type.startsWith("ADMIN_MEETING"))) {
    return `/admin/proposals/${ids.proposalId}`;
  }
  if (type === "ADMIN_OVERDUE_FOLLOWUP") return "/admin/follow-ups";
  if (type === "ADMIN_SUSPICIOUS_ACTIVITY" || type === "ADMIN_DUPLICATE_PROFILE_ALERT") return "/admin/security-flags";
  // STEP 24 — risk & safety notifications open the Risk & Safety Center.
  if (type === "DUPLICATE_REVIEW_REQUIRED") return "/admin/risk-center/duplicates";
  if (type === "COMMUNICATION_PROVIDER_ALERT" || type === "COMMUNICATION_REVIEW_REQUIRED") return "/admin/communications";
  if (type === "ADMIN_DOCUMENT_REVIEW_QUEUE" || type === "ADMIN_DOCUMENT_SECURITY_ALERT") return "/admin/documents";
  if (type === "ADMIN_REFERRAL_REVIEW_REQUIRED") return "/admin/membership/referrals";
  if (["CRM_FOLLOWUP_DUE", "CRM_FOLLOWUP_OVERDUE", "CRM_STAGE_CHANGED", "CRM_ASSIGNED_TO_YOU", "CRM_SLA_ESCALATED"].includes(type)) return "/admin/crm";
  if (type === "LEAD_ASSIGNED_TO_YOU") return "/admin/crm/leads";
  if (["HIGH_RISK_DETECTED", "CRITICAL_RISK_DETECTED", "VERIFICATION_RISK", "ACCOUNT_SECURITY_ALERT", "CONTACT_BYPASS_DETECTED", "ADMIN_ACCESS_ANOMALY", "SAFETY_REPORT_RECEIVED", "RISK_REVIEW_DUE", "RISK_CASE_ESCALATED"].includes(type)) return "/admin/risk-center";
  if (type === "ADMIN_PROFILE_UPDATE_PENDING" && ids.profileId) return `/admin/profiles/${ids.profileId}`;
  if (type === "ADMIN_ASSIGNMENT_CHANGED" && ids.proposalId) return `/admin/proposals/${ids.proposalId}`;
  return undefined;
}
