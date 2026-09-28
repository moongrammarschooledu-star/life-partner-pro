import { randomUUID } from "crypto";
import type { DeliveryStatus } from "@prisma/client";
import type { CommunicationProvider, OutboundMessage, ParsedWebhookEvent, ProviderHealth, RecipientValidation, SendResult, WebhookVerification } from "@/lib/communications/providers/types";

// InAppProviderAdapter - in-app messages live in our own database (Notification / thread rows) so "sending" is local and
// instantaneous; there is no external service, no webhook and nothing that can bounce.
export class InAppProviderAdapter implements CommunicationProvider {
  readonly adapterKey = "INAPP";
  readonly channel = "IN_APP" as const;
  readonly external = false;

  isConfigured(): boolean {
    return true;
  }

  async sendMessage(_msg: OutboundMessage): Promise<SendResult> { // eslint-disable-line @typescript-eslint/no-unused-vars
    return { ok: true, providerMessageId: `inapp-${randomUUID()}` };
  }
  sendTemplate = (msg: Parameters<CommunicationProvider["sendTemplate"]>[0]) => this.sendMessage(msg);
  sendTransactional = (msg: OutboundMessage) => this.sendMessage(msg);
  sendOTP = (msg: OutboundMessage) => this.sendMessage(msg);
  sendBulk = async (msgs: OutboundMessage[]) => Promise.all(msgs.map((m) => this.sendMessage(m)));

  async getMessageStatus(): Promise<{ supported: boolean; status: DeliveryStatus | null }> {
    return { supported: false, status: null };
  }

  verifyWebhook(): WebhookVerification {
    return { valid: false, reason: "NO_WEBHOOKS_FOR_IN_APP" };
  }

  parseWebhookEvent(): ParsedWebhookEvent[] | null {
    return null;
  }

  validateRecipient(to: string): RecipientValidation {
    return to ? { valid: true, normalized: to } : { valid: false, reason: "EMPTY" };
  }

  async checkProviderHealth(): Promise<ProviderHealth> {
    return { status: "HEALTHY" };
  }
}
