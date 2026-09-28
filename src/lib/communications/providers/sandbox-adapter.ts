import { createHmac, randomUUID } from "crypto";
import type { DeliveryStatus, NotificationChannel } from "@prisma/client";
import { defaultBulk, normalizePhone, parseEnvelopeEvents, redactForLog, templateToText, validateEmailAddress, verifyEnvelope } from "@/lib/communications/providers/shared";
import type { CommunicationProvider, EnvMap, OutboundMessage, ParsedWebhookEvent, ProviderHealth, RecipientValidation, SendResult, WebhookRequestData, WebhookVerification } from "@/lib/communications/providers/types";

// SandboxProviderAdapter - the "nothing leaves the system" provider. It is what runs when no real provider is configured, and
// what the environment guard swaps in for real providers outside production. It NEVER reports DELIVERED or READ: a send is
// only ever "handed to the sandbox" (SENT). Delivery states can only be introduced through the signed webhook envelope (used by
// the admin "simulate webhook" tool and by tests), exactly like a real provider.

// The sandbox webhook secret is derived from server secrets when not set explicitly, so the sandbox endpoint is never open.
export function sandboxWebhookSecret(env: EnvMap = process.env): string | undefined {
  if (env.COMMUNICATION_SANDBOX_WEBHOOK_SECRET?.trim()) return env.COMMUNICATION_SANDBOX_WEBHOOK_SECRET.trim();
  if (!env.NEXTAUTH_SECRET) return undefined;
  return createHmac("sha256", env.NEXTAUTH_SECRET).update("communication-sandbox-webhook").digest("hex");
}

export class SandboxProviderAdapter implements CommunicationProvider {
  readonly adapterKey = "SANDBOX";
  readonly external = false;

  constructor(
    readonly channel: NotificationChannel,
    private env: EnvMap = process.env
  ) {}

  isConfigured(): boolean {
    return true;
  }

  async sendMessage(msg: OutboundMessage): Promise<SendResult> {
    const check = this.validateRecipient(msg.to);
    if (!check.valid) return { ok: false, failureClass: "PERMANENT", rejected: true, error: `INVALID_RECIPIENT:${check.reason}` };
    // Console visibility for developers; OTP-like content is redacted in production unless COMMUNICATION_DEBUG_OTP=true.
    console.log(`[communication:sandbox:${this.channel}] to=${check.normalized} :: ${msg.subject ?? ""} :: ${redactForLog(msg.body, msg.purpose, this.env)}`);
    return { ok: true, providerMessageId: `sandbox-${this.channel.toLowerCase()}-${randomUUID()}` };
  }

  sendTemplate = (msg: Parameters<CommunicationProvider["sendTemplate"]>[0]) => this.sendMessage(templateToText(msg));
  sendTransactional = (msg: OutboundMessage) => this.sendMessage(msg);
  sendOTP = (msg: OutboundMessage) => this.sendMessage({ ...msg, purpose: "OTP" });
  sendBulk = (msgs: OutboundMessage[]) => defaultBulk((m) => this.sendMessage(m), msgs);

  async getMessageStatus(): Promise<{ supported: boolean; status: DeliveryStatus | null }> {
    return { supported: false, status: null };
  }

  verifyWebhook(req: WebhookRequestData): WebhookVerification {
    return verifyEnvelope(req.headers, req.rawBody, sandboxWebhookSecret(this.env));
  }

  parseWebhookEvent(req: WebhookRequestData): ParsedWebhookEvent[] | null {
    return parseEnvelopeEvents(req.rawBody);
  }

  validateRecipient(to: string): RecipientValidation {
    return this.channel === "EMAIL" ? validateEmailAddress(to) : this.channel === "IN_APP" ? { valid: true, normalized: to } : normalizePhone(to);
  }

  async checkProviderHealth(): Promise<ProviderHealth> {
    return { status: "HEALTHY", detail: "Sandbox provider (no real delivery)." };
  }
}
