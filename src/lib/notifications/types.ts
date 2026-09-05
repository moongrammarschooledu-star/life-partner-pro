import type { NotificationType } from "@prisma/client";

// Shared input shapes for the notification service (src/lib/notifications/notification-service.ts).
// Exactly one of profileId/adminId must be set on SendNotificationInput.

export interface SendNotificationInput {
  profileId?: string;
  adminId?: string;
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
}
