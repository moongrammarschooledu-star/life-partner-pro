import type { NotificationType } from "@prisma/client";

// Every target path below is an existing cookie-session (public) or
// NextAuth-session (admin) gated page that already re-derives identity
// server-side — a notification link is never itself treated as proof of
// permission (spec §22). Pure — no I/O.
export function buildActionUrl(
  recipientKind: "PROFILE" | "ADMIN",
  type: NotificationType,
  ids: { proposalId?: string; profileId?: string }
): string | undefined {
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
    return "/my-notifications";
  }

  // ADMIN
  if (ids.proposalId && (type.startsWith("ADMIN_MUTUAL") || type.startsWith("ADMIN_CONTACT") || type.startsWith("ADMIN_MEETING"))) {
    return `/admin/proposals/${ids.proposalId}`;
  }
  if (type === "ADMIN_OVERDUE_FOLLOWUP") return "/admin/follow-ups";
  if (type === "ADMIN_SUSPICIOUS_ACTIVITY" || type === "ADMIN_DUPLICATE_PROFILE_ALERT") return "/admin/security-flags";
  if (type === "ADMIN_PROFILE_UPDATE_PENDING" && ids.profileId) return `/admin/profiles/${ids.profileId}`;
  if (type === "ADMIN_ASSIGNMENT_CHANGED" && ids.proposalId) return `/admin/proposals/${ids.proposalId}`;
  return undefined;
}
