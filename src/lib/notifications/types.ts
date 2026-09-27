import type { NotificationType } from "@prisma/client";
import type { AdminRole } from "@/lib/permissions";

// Shared input shapes for the notification service (src/lib/notifications/notification-service.ts).
// Exactly one of profileId/adminId/familyMemberId must be set on SendNotificationInput.

export interface SendNotificationInput {
  profileId?: string;
  adminId?: string;
  // STEP 22 — third recipient kind. Stays IN_APP only (no external
  // email/SMS/WhatsApp dispatch pipeline for family members in this pass),
  // matching the existing admin-recipient convention below.
  familyMemberId?: string;
  type: NotificationType;
  data: {
    // Title/body are NOT passed in — they're always rendered via
    // template-resolver.ts (DB override -> default-templates.ts -> English
    // fallback) so every channel, including IN_APP, stays admin-customizable
    // and privacy-safe by construction (spec §19/§33).
    relatedProposalId?: string;
    relatedProfileId?: string;
    templateVars?: Record<string, string>;
    isTest?: boolean;
  };
}

export interface NotifyAdminsInput {
  type: NotificationType;
  data: SendNotificationInput["data"];
  assignedAdminId?: string | null;
  // STEP 23 Add-on — targets a specific role set (e.g. COMPLIANCE_MANAGER)
  // instead of the default SUPER_ADMIN/ADMIN/OPERATIONS_ADMIN fan-out.
  // SUPER_ADMIN is always included alongside whatever is given here, so a
  // compliance-only notification is never invisible to the one role that
  // can always see everything.
  roles?: AdminRole[];
}
