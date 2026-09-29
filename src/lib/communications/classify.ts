import type { CommunicationMessageType, CommunicationPurpose, NotificationType } from "@prisma/client";

// Maps the existing NotificationType vocabulary onto the STEP 25 message type / purpose / center category. Pure - one place to
// review, exactly like NOTIFICATION_CLASSIFICATION does for preferences. Unknown/new types fall through to SYSTEM (never marketing).

export interface NotificationDescription {
  messageType: CommunicationMessageType;
  purpose: CommunicationPurpose;
  category: string; // notification-center category
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
}

const starts = (type: string, ...prefixes: string[]) => prefixes.some((p) => type.startsWith(p));

export function describeNotification(type: NotificationType): NotificationDescription {
  const t: string = type;
  if (t === "SECURITY_NOTICE" || t === "ACCOUNT_SECURITY_ALERT" || t === "ACCOUNT_SUSPENDED") return { messageType: "SECURITY", purpose: "SECURITY", category: "SECURITY", priority: "URGENT" };
  if (t === "MOBILE_VERIFIED" || t === "EMAIL_VERIFIED" || starts(t, "VERIFICATION_", "KYC_") || t === "RE_VERIFICATION_REQUIRED" || t === "RISK_INFORMATION_REQUESTED")
    return { messageType: "VERIFICATION", purpose: "VERIFICATION", category: "VERIFICATION", priority: "HIGH" };
  if (t.startsWith("CONTACT_PERMISSION")) return { messageType: "PROPOSAL", purpose: "CONTACT_PERMISSION", category: "PROPOSAL", priority: "HIGH" };
  if (t === "MATCH_IDENTIFIED") return { messageType: "MATCHING", purpose: "MATCH", category: "PROPOSAL", priority: "NORMAL" };
  if (starts(t, "PROPOSAL_")) return { messageType: "PROPOSAL", purpose: "PROPOSAL", category: "PROPOSAL", priority: t === "PROPOSAL_PENDING_REMINDER" ? "LOW" : "NORMAL" };
  if (starts(t, "MEETING_")) return { messageType: "MEETING", purpose: "MEETING", category: "MEETING", priority: t.startsWith("MEETING_REMINDER") ? "HIGH" : "NORMAL" };
  if (starts(t, "FOLLOWUP_")) return { messageType: "TRANSACTIONAL", purpose: "FOLLOWUP", category: "SUPPORT", priority: "LOW" };
  if (starts(t, "PAYMENT_", "REFUND_", "SUBSCRIPTION_", "INVOICE_") || t === "MANUAL_PAYMENT_REQUIRES_REVIEW") return { messageType: "PAYMENT", purpose: "PAYMENT", category: "PAYMENT", priority: "NORMAL" };
  if (starts(t, "DELETION_", "PRIVACY_") || t === "DATA_EXPORT_READY" || t === "ACCOUNT_DEACTIVATED" || t === "ACCOUNT_REACTIVATED") return { messageType: "PRIVACY", purpose: "PRIVACY", category: "PRIVACY", priority: "NORMAL" };
  if (starts(t, "CASE_") || t === "INFORMATION_REQUESTED" || t === "USER_RESPONDED" || t === "SAFETY_REPORT_ACKNOWLEDGED" || t === "ADMIN_DIRECT_MESSAGE") return { messageType: "SUPPORT", purpose: "SUPPORT", category: "SUPPORT", priority: "NORMAL" };
  if (starts(t, "FAMILY_")) return { messageType: "FAMILY", purpose: "FAMILY_ACCESS", category: "FAMILY", priority: "NORMAL" };
  if (starts(t, "ADMIN_", "TASK_", "APPROVAL_", "COMPLIANCE_", "COMMUNICATION_") || ["HIGH_RISK_DETECTED", "CRITICAL_RISK_DETECTED", "DUPLICATE_REVIEW_REQUIRED", "VERIFICATION_RISK", "CONTACT_BYPASS_DETECTED", "SAFETY_REPORT_RECEIVED", "RISK_REVIEW_DUE", "RISK_CASE_ESCALATED", "EMERGENCY_OVERRIDE_USED", "PROVIDER_VERIFICATION_FAILURE"].includes(t))
    return { messageType: "ADMIN_INTERNAL", purpose: "ADMIN_INTERNAL", category: "SYSTEM", priority: "NORMAL" };
  if (t === "ACCOUNT_REGISTERED" || starts(t, "PROFILE_")) return { messageType: "TRANSACTIONAL", purpose: "ACCOUNT", category: "SYSTEM", priority: "NORMAL" };
  // STEP 26 — document management (ADMIN_DOCUMENT_* is already caught by the ADMIN_ branch above).
  if (t === "DOCUMENT_EXPIRING_SOON") return { messageType: "TRANSACTIONAL", purpose: "FOLLOWUP", category: "SUPPORT", priority: "LOW" };
  if (starts(t, "DOCUMENT_")) return { messageType: "SUPPORT", purpose: "SUPPORT", category: "SUPPORT", priority: "HIGH" };
  return { messageType: "SYSTEM", purpose: "ACCOUNT", category: "SYSTEM", priority: "NORMAL" };
}

// What a message type is allowed to be about. A mismatch (e.g. MARKETING with purpose OTP) is refused by the policy engine.
export const ALLOWED_PURPOSES: Record<CommunicationMessageType, CommunicationPurpose[]> = {
  TRANSACTIONAL: ["ACCOUNT", "PROFILE", "FOLLOWUP", "SUPPORT"],
  SECURITY: ["SECURITY", "OTP", "ACCOUNT"],
  VERIFICATION: ["VERIFICATION", "OTP", "PROFILE"],
  PROPOSAL: ["PROPOSAL", "CONTACT_PERMISSION", "FOLLOWUP"],
  MATCHING: ["MATCH"],
  MEETING: ["MEETING", "FOLLOWUP"],
  SUPPORT: ["SUPPORT", "FOLLOWUP"],
  FAMILY: ["FAMILY_ACCESS", "PROPOSAL", "MEETING"],
  PAYMENT: ["PAYMENT"],
  PRIVACY: ["PRIVACY"],
  SYSTEM: ["ACCOUNT", "PROFILE", "FOLLOWUP", "SUPPORT"],
  ADMIN_INTERNAL: ["ADMIN_INTERNAL"],
  MARKETING: ["MARKETING"],
};

export const SENSITIVE_PURPOSES: CommunicationPurpose[] = ["PRIVACY", "PAYMENT", "SECURITY", "CONTACT_PERMISSION"];

export type MessageClass = "security" | "transactional" | "marketing";

export function messageClassOf(type: CommunicationMessageType): MessageClass {
  if (type === "SECURITY" || type === "VERIFICATION") return "security";
  if (type === "MARKETING") return "marketing";
  return "transactional";
}

export const CLASS_MESSAGE_TYPES: Record<MessageClass, CommunicationMessageType[]> = {
  security: ["SECURITY", "VERIFICATION"],
  marketing: ["MARKETING"],
  transactional: ["TRANSACTIONAL", "PROPOSAL", "MATCHING", "MEETING", "SUPPORT", "FAMILY", "PAYMENT", "PRIVACY", "SYSTEM", "ADMIN_INTERNAL"],
};
