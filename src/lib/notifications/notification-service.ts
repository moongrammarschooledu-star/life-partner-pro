import { prisma } from "@/lib/prisma";
import type { NotificationChannel, NotificationPreference } from "@prisma/client";
import { maskEmail, maskPhone } from "@/lib/verification/otp";
import { classify, shouldAttemptExternalChannel, type PreferenceCategory } from "@/lib/notifications/classification";
import { resolveTemplate } from "@/lib/notifications/template-resolver";
import { dispatchChannel } from "@/lib/notifications/dispatch";
import { buildActionUrl } from "@/lib/notifications/deep-link";
import { checkDailyLimit } from "@/lib/notifications/anti-spam";
import type { SendNotificationInput, NotifyAdminsInput } from "@/lib/notifications/types";

const MAX_DAILY_SENDS_PER_CHANNEL = 20;
const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;

const PREFERENCE_CHANNEL_KEY: Record<NotificationChannel, "inApp" | "email" | "sms" | "whatsapp" | null> = {
  IN_APP: "inApp",
  EMAIL: "email",
  SMS: "sms",
  WHATSAPP: "whatsapp",
};

const PREFERENCE_CATEGORY_KEY: Record<Exclude<PreferenceCategory, null>, string> = {
  PROPOSAL: "ProposalUpdates",
  MEETING: "MeetingUpdates",
  FOLLOWUP: "FollowUpReminders",
  MARKETING: "Marketing",
};

function getPreferenceValue(
  pref: NotificationPreference | null,
  channel: NotificationChannel,
  category: Exclude<PreferenceCategory, null>
): boolean | null {
  if (!pref) return null;
  const channelKey = PREFERENCE_CHANNEL_KEY[channel];
  if (!channelKey) return null;
  const field = `${channelKey}${PREFERENCE_CATEGORY_KEY[category]}` as keyof NotificationPreference;
  const value = pref[field];
  return typeof value === "boolean" ? value : null;
}

async function isDuplicateRecent(recipientProfileId: string | null, recipientAdminId: string | null, type: string, relatedProposalId: string | null) {
  const since = new Date(Date.now() - DUPLICATE_WINDOW_MS);
  const existing = await prisma.notification.findFirst({
    where: {
      recipientProfileId,
      recipientAdminId,
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
    const { profileId, adminId, type, data } = input;
    if (!profileId && !adminId) return;

    if (await isDuplicateRecent(profileId ?? null, adminId ?? null, type, data.relatedProposalId ?? null)) return;

    const language = profileId
      ? ((await prisma.profile.findUnique({ where: { id: profileId }, select: { preferredLanguage: true } }))?.preferredLanguage ?? "EN")
      : "EN";

    const inApp = await resolveTemplate(type, "IN_APP", language, data.templateVars ?? {});
    const actionUrl = buildActionUrl(profileId ? "PROFILE" : "ADMIN", type, {
      proposalId: data.relatedProposalId,
      profileId: data.relatedProfileId,
    });

    await prisma.notification.create({
      data: {
        recipientProfileId: profileId ?? null,
        recipientAdminId: adminId ?? null,
        type,
        title: inApp.title,
        body: inApp.body,
        relatedProposalId: data.relatedProposalId ?? null,
        relatedProfileId: data.relatedProfileId ?? null,
        actionUrl: actionUrl ?? null,
      },
    });

    if (!profileId) return; // admin recipients get in-app only — no external dispatch

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

async function dispatchExternalChannels(
  profileId: string,
  type: SendNotificationInput["type"],
  data: SendNotificationInput["data"],
  language: "EN" | "UR"
) {
  const [settings, contact, preference, consents] = await Promise.all([
    prisma.appSettings.findUnique({ where: { id: 1 } }),
    prisma.contactInfo.findUnique({ where: { profileId } }),
    prisma.notificationPreference.findUnique({ where: { profileId } }),
    prisma.communicationConsent.findMany({ where: { profileId } }),
  ]);
  if (!contact) return;

  const { preferenceCategory } = classify(type);
  const consentByChannel = new Map(consents.map((c) => [c.channel, c.status]));

  const channels: { channel: NotificationChannel; enabled: boolean; destination: string | null }[] = [
    { channel: "EMAIL", enabled: settings?.emailNotificationsEnabled ?? true, destination: contact.email },
    { channel: "SMS", enabled: settings?.smsNotificationsEnabled ?? false, destination: contact.mobileNumber },
    { channel: "WHATSAPP", enabled: settings?.whatsappNotificationsEnabled ?? false, destination: contact.whatsappNumber ?? null },
  ];

  for (const { channel, enabled, destination } of channels) {
    if (!destination) continue;

    const attempt = shouldAttemptExternalChannel({
      type,
      channelEnabledInSettings: enabled,
      preferenceValue: preferenceCategory ? getPreferenceValue(preference, channel, preferenceCategory) : null,
      consentStatus: (consentByChannel.get(channel) as "GRANTED" | "REVOKED" | undefined) ?? null,
    });
    if (!attempt) continue;
    if (!checkDailyLimit(profileId, channel, MAX_DAILY_SENDS_PER_CHANNEL)) continue;

    const rendered = await resolveTemplate(type, channel, language, data.templateVars ?? {});
    const masked = channel === "EMAIL" ? maskEmail(destination) : maskPhone(destination);

    const log = await prisma.communicationLog.create({
      data: {
        profileId,
        proposalId: data.relatedProposalId ?? null,
        channel,
        notificationType: type,
        templateKey: type,
        recipientReference: masked,
        messageBody: rendered.body,
        isTest: data.isTest ?? false,
      },
    });

    await dispatchChannel(log.id, channel, destination, rendered.body, rendered.subject);
  }
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
}): Promise<{ logId: string }> {
  const language =
    (await prisma.profile.findUnique({ where: { id: params.profileId }, select: { preferredLanguage: true } }))?.preferredLanguage ?? "EN";

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
    },
  });

  const now = new Date();
  if (params.channel === "IN_APP") {
    const log = await prisma.communicationLog.create({
      data: {
        profileId: params.profileId,
        proposalId: params.proposalId ?? null,
        channel: "IN_APP",
        notificationType: "ADMIN_DIRECT_MESSAGE",
        deliveryStatus: "DELIVERED",
        messageBody: params.message,
        sentAt: now,
        deliveredAt: now,
        createdById: params.adminId,
      },
    });
    return { logId: log.id };
  }

  const contact = await prisma.contactInfo.findUnique({ where: { profileId: params.profileId } });
  const destination = params.channel === "EMAIL" ? contact?.email : params.channel === "WHATSAPP" ? contact?.whatsappNumber : contact?.mobileNumber;
  if (!destination) throw new Error("This profile has no destination on file for the selected channel.");

  const masked = params.channel === "EMAIL" ? maskEmail(destination) : maskPhone(destination);
  const log = await prisma.communicationLog.create({
    data: {
      profileId: params.profileId,
      proposalId: params.proposalId ?? null,
      channel: params.channel,
      notificationType: "ADMIN_DIRECT_MESSAGE",
      recipientReference: masked,
      messageBody: params.message,
      createdById: params.adminId,
    },
  });

  await dispatchChannel(log.id, params.channel, destination, params.message);
  return { logId: log.id };
}

// Notifies the assigned admin if one exists, else every active
// SUPER_ADMIN/ADMIN (small headcount — one row each). Admin notifications
// stay IN_APP only, no external dispatch (spec §4 just asks for mark-read/
// mark-all-read/open-record, not SMS/email to staff).
export async function notifyAdmins(input: NotifyAdminsInput): Promise<void> {
  try {
    if (input.assignedAdminId) {
      await sendNotification({ adminId: input.assignedAdminId, type: input.type, data: input.data });
      return;
    }
    const admins = await prisma.adminUser.findMany({
      where: { active: true, role: { in: ["SUPER_ADMIN", "ADMIN"] } },
      select: { id: true },
    });
    await Promise.all(admins.map((a) => sendNotification({ adminId: a.id, type: input.type, data: input.data })));
  } catch (error) {
    console.error("[notifications] notifyAdmins failed", error);
  }
}
