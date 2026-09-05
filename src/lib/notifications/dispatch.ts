import { prisma } from "@/lib/prisma";
import type { NotificationChannel } from "@prisma/client";
import { emailProvider } from "@/lib/notifications/providers/email-provider";
import { smsProvider } from "@/lib/notifications/providers/sms-provider";
import { whatsappProvider } from "@/lib/notifications/providers/whatsapp-provider";
import type { NotificationProvider } from "@/lib/notifications/providers/types";

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
