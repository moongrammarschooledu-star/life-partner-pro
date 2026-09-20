import { prisma } from "@/lib/prisma";
import type { NotificationChannel } from "@prisma/client";
import { emailProvider } from "@/lib/notifications/providers/email-provider";
import { smsProvider } from "@/lib/notifications/providers/sms-provider";
import { whatsappProvider } from "@/lib/notifications/providers/whatsapp-provider";
import type { NotificationProvider } from "@/lib/notifications/providers/types";
import { isEmergencyDisabled } from "@/lib/ops/system-control";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";

const PROVIDERS: Partial<Record<NotificationChannel, NotificationProvider>> = {
  EMAIL: emailProvider,
  SMS: smsProvider,
  WHATSAPP: whatsappProvider,
};

// Attempts delivery for one already-created CommunicationLog row (channel
// enabled/consent/preference decisions already made by the caller —
// notification-service.ts) and updates its status. Never throws (spec §31 —
// a provider failure must never propagate back into the triggering request).
export async function dispatchChannel(logId: string, channel: NotificationChannel, to: string, body: string, subject?: string): Promise<void> {
  const provider = PROVIDERS[channel];
  if (!provider) {
    // IN_APP has no provider — the row is already DELIVERED at creation time.
    return;
  }

  // STEP 15 §28/§56 — kill switch / feature flags for external delivery. The
  // row is marked FAILED (not lost) so the bounded retry job can deliver it
  // once notifications are switched back on.
  const disabled = (await isEmergencyDisabled("notifications")) || !(await isFeatureEnabled("notifications.enabled")) || (channel === "WHATSAPP" && !(await isFeatureEnabled("whatsapp.enabled")));
  if (disabled) {
    await prisma.communicationLog.update({ where: { id: logId }, data: { deliveryStatus: "FAILED", failureReason: "Notifications are temporarily disabled" } });
    return;
  }

  try {
    const result = await provider.send(to, body, subject);
    await prisma.communicationLog.update({
      where: { id: logId },
      data: { deliveryStatus: "SENT", sentAt: new Date(), providerMessageId: result.providerMessageId ?? null, failureReason: null },
    });
  } catch (error) {
    await prisma.communicationLog.update({
      where: { id: logId },
      data: { deliveryStatus: "FAILED", failureReason: error instanceof Error ? error.message : "Unknown delivery error" },
    });
  }
}
