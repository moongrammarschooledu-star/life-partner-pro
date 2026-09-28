import { prisma } from "@/lib/prisma";
import type { NotificationChannel } from "@prisma/client";
import { resolveTemplate } from "@/lib/notifications/template-resolver";
import { buildActionUrl } from "@/lib/notifications/deep-link";
import { describeNotification } from "@/lib/communications/classify";
import type { SendNotificationInput, NotifyAdminsInput } from "@/lib/notifications/types";

const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;

async function isDuplicateRecent(
  recipientProfileId: string | null,
  recipientAdminId: string | null,
  type: string,
  relatedProposalId: string | null,
  recipientFamilyMemberId: string | null = null
) {
  const since = new Date(Date.now() - DUPLICATE_WINDOW_MS);
  const existing = await prisma.notification.findFirst({
    where: {
      recipientProfileId,
      recipientAdminId,
      recipientFamilyMemberId,
      type: type as never,
      relatedProposalId,
      createdAt: { gte: since },
    },
    select: { id: true },
  });
  return !!existing;
}

// The central entry point (spec §1's literal `sendNotification(userId, notificationType, data)`
// example). Never throws — a failure anywhere in here must never break the
// caller's core matrimonial-workflow write (spec §31).
export async function sendNotification(input: SendNotificationInput): Promise<void> {
  try {
    const { profileId, adminId, familyMemberId, type, data } = input;
    if (!profileId && !adminId && !familyMemberId) return;

    if (await isDuplicateRecent(profileId ?? null, adminId ?? null, type, data.relatedProposalId ?? null, familyMemberId ?? null)) return;

    const language = profileId
      ? ((await prisma.profile.findUnique({ where: { id: profileId }, select: { preferredLanguage: true } }))?.preferredLanguage ?? "EN")
      : "EN";

    const recipientKind = profileId ? "PROFILE" : familyMemberId ? "FAMILY" : "ADMIN";
    const inApp = await resolveTemplate(type, "IN_APP", language, data.templateVars ?? {});
    const actionUrl = buildActionUrl(recipientKind, type, {
      proposalId: data.relatedProposalId,
      profileId: data.relatedProfileId,
    });

    await prisma.notification.create({
      data: {
        recipientProfileId: profileId ?? null,
        recipientAdminId: adminId ?? null,
        recipientFamilyMemberId: familyMemberId ?? null,
        type,
        title: inApp.title,
        body: inApp.body,
        relatedProposalId: data.relatedProposalId ?? null,
        relatedProfileId: data.relatedProfileId ?? null,
        actionUrl: actionUrl ?? null,
        priority: describeNotification(type).priority,
        category: describeNotification(type).category,
      },
    });

    if (!profileId) return; // admin/family recipients get in-app only — no external dispatch

    const now = new Date();
    await prisma.communicationLog.create({
      data: {
        profileId,
        proposalId: data.relatedProposalId ?? null,
        channel: "IN_APP",
        notificationType: type,
        templateKey: type,
        deliveryStatus: "DELIVERED",
        messageBody: inApp.body,
        sentAt: now,
        deliveredAt: now,
        isTest: data.isTest ?? false,
      },
    });

    await dispatchExternalChannels(profileId, type, data, language);
  } catch (error) {
    console.error("[notifications] sendNotification failed", error);
  }
}

// External delivery is owned by the communication stack (src/lib/communications): template selection, the policy engine (consent,
// preferences, suppression, frequency, jurisdiction, quiet hours, provider eligibility), the encrypted queue and provider adapters.
async function dispatchExternalChannels(
  profileId: string,
  type: SendNotificationInput["type"],
  data: SendNotificationInput["data"],
  language: "EN" | "UR"
) {
  const { dispatchEventToExternalChannels } = await import("@/lib/communications/event-dispatch");
  await dispatchEventToExternalChannels({ profileId, type, language, relatedProposalId: data.relatedProposalId ?? null, templateVars: data.templateVars, isTest: data.isTest });
}

// Admin-composed manual send (spec §12) — unlike sendNotification(), this
// intentionally does NOT swallow errors: the admin has already confirmed a
// specific Recipient/Channel/Message via the UI's ConfirmDialog preview and
// needs to know if it failed. The in-app Notification stays generic
// (ADMIN_DIRECT_MESSAGE default copy); only CommunicationLog.messageBody
// carries the admin's literal text, gated by communication:message:view.
export async function sendAdminComposedMessage(params: {
  profileId: string;
  proposalId?: string;
  channel: NotificationChannel;
  message: string;
  adminId: string;
  permissions?: readonly string[];
}): Promise<{ logId: string; status: string }> {
  const language =
    (await prisma.profile.findUnique({ where: { id: params.profileId }, select: { preferredLanguage: true } }))?.preferredLanguage ?? "EN";

  const { communicate } = await import("@/lib/communications/send-service");
  const { otherPartyContact } = await import("@/lib/communications/event-dispatch");
  void language;

  // Goes through the policy engine like every other message (consent, suppression, frequency, jurisdiction, provider eligibility),
  // and can never carry the OTHER party's contact details.
  const result = await communicate({
    intent: {
      recipient: { type: "PROFILE", profileId: params.profileId },
      channel: params.channel,
      messageType: "SUPPORT",
      purpose: "SUPPORT",
      eventKey: "ADMIN_DIRECT_MESSAGE",
      automated: false,
      initiatedBy: { adminId: params.adminId, permissions: params.permissions ?? [] },
      proposalId: params.proposalId ?? null,
    },
    body: params.message,
    protectedStrings: await otherPartyContact(params.profileId, params.proposalId),
    createReviewTask: false,
  });
  if (result.status === "BLOCKED") throw new Error(result.reasons[0] ?? "This message cannot be sent.");
  if (!result.logId) throw new Error("This profile has no destination on file for the selected channel.");

  // The in-app notification stays generic (ADMIN_DIRECT_MESSAGE default copy); only the encrypted message record carries the text.
  const inApp = await resolveTemplate("ADMIN_DIRECT_MESSAGE", "IN_APP", language, {});
  const actionUrl = buildActionUrl("PROFILE", "ADMIN_DIRECT_MESSAGE", { proposalId: params.proposalId });
  await prisma.notification.create({
    data: {
      recipientProfileId: params.profileId,
      type: "ADMIN_DIRECT_MESSAGE",
      title: inApp.title,
      body: inApp.body,
      relatedProposalId: params.proposalId ?? null,
      actionUrl: actionUrl ?? null,
      priority: "NORMAL",
      category: "SUPPORT",
    },
  });
  return { logId: result.logId, status: result.status };
}

// Notifies the assigned admin if one exists, else every active
// SUPER_ADMIN/OPERATIONS_ADMIN (small headcount — one row each; legacy ADMIN
// kept for any not-yet-migrated row, STEP 17). Admin notifications stay
// IN_APP only, no external dispatch (spec §4 just asks for mark-read/
// mark-all-read/open-record, not SMS/email to staff).
export async function notifyAdmins(input: NotifyAdminsInput): Promise<void> {
  try {
    if (input.assignedAdminId) {
      await sendNotification({ adminId: input.assignedAdminId, type: input.type, data: input.data });
      return;
    }
    const roles = input.roles?.length ? [...new Set([...input.roles, "SUPER_ADMIN"])] : ["SUPER_ADMIN", "ADMIN", "OPERATIONS_ADMIN"];
    const admins = await prisma.adminUser.findMany({
      where: { active: true, role: { in: roles as never[] } },
      select: { id: true },
    });
    await Promise.all(admins.map((a) => sendNotification({ adminId: a.id, type: input.type, data: input.data })));
  } catch (error) {
    console.error("[notifications] notifyAdmins failed", error);
  }
}
