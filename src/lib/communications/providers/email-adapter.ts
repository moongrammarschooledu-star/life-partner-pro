import type { DeliveryStatus } from "@prisma/client";
import { emailProvider, isEmailConfigured } from "@/lib/notifications/providers/email-provider";
import { defaultBulk, parseEnvelopeEvents, templateToText, validateEmailAddress, verifyEnvelope } from "@/lib/communications/providers/shared";
import type { CommunicationProvider, EnvMap, OutboundMessage, ParsedWebhookEvent, ProviderHealth, RecipientValidation, SendResult, WebhookRequestData, WebhookVerification } from "@/lib/communications/providers/types";

// EmailProviderAdapter - real delivery over the existing SMTP transport (nodemailer). SMTP itself has no delivery webhooks, so
// bounces / complaints / unsubscribes arrive from an ESP or a forwarder as the generic signed envelope (EMAIL_WEBHOOK_SECRET).
export class EmailProviderAdapter implements CommunicationProvider {
  readonly adapterKey = "EMAIL_SMTP";
  readonly channel = "EMAIL" as const;
  readonly external = true;

  constructor(private env: EnvMap = process.env) {}

  isConfigured(): boolean {
    return isEmailConfigured(this.env);
  }

  async sendMessage(msg: OutboundMessage): Promise<SendResult> {
    const check = this.validateRecipient(msg.to);
    if (!check.valid) return { ok: false, failureClass: "PERMANENT", rejected: true, error: `INVALID_RECIPIENT:${check.reason}` };
    try {
      const result = await emailProvider.send(check.normalized as string, msg.body, msg.subject, msg.html);
      return { ok: true, providerMessageId: result.providerMessageId };
    } catch (error) {
      const code = (error as { responseCode?: number }).responseCode;
      const message = error instanceof Error ? error.message.slice(0, 200) : "SMTP error";
      // 5xx SMTP replies (mailbox unavailable, rejected, policy) are permanent; connection / 4xx replies are worth retrying.
      if (typeof code === "number" && code >= 500) return { ok: false, failureClass: "PERMANENT", rejected: code === 550 || code === 553, error: message };
      return { ok: false, failureClass: "RETRYABLE", error: message };
    }
  }

  sendTemplate = (msg: Parameters<CommunicationProvider["sendTemplate"]>[0]) => this.sendMessage(templateToText(msg));
  sendTransactional = (msg: OutboundMessage) => this.sendMessage(msg);
  sendOTP = (msg: OutboundMessage) => this.sendMessage(msg);
  sendBulk = (msgs: OutboundMessage[]) => defaultBulk((m) => this.sendMessage(m), msgs);

  async getMessageStatus(): Promise<{ supported: boolean; status: DeliveryStatus | null }> {
    return { supported: false, status: null }; // SMTP cannot report delivery; only webhooks can. Never guessed.
  }

  verifyWebhook(req: WebhookRequestData): WebhookVerification {
    return verifyEnvelope(req.headers, req.rawBody, this.env.EMAIL_WEBHOOK_SECRET);
  }

  parseWebhookEvent(req: WebhookRequestData): ParsedWebhookEvent[] | null {
    return parseEnvelopeEvents(req.rawBody);
  }

  validateRecipient(to: string): RecipientValidation {
    return validateEmailAddress(to);
  }

  async checkProviderHealth(): Promise<ProviderHealth> {
    return this.isConfigured() ? { status: "UNKNOWN", detail: "SMTP is configured; health is derived from recent delivery outcomes." } : { status: "DOWN", detail: "SMTP credentials are not configured." };
  }
}
