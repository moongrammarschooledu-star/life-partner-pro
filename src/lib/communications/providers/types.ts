import type { DeliveryStatus, NotificationChannel } from "@prisma/client";

// The provider abstraction (spec §3). Application code depends ONLY on this interface; every vendor-specific detail
// (Twilio, Meta Cloud API, SMTP, ...) lives inside one adapter file. Adapters never throw for an expected provider answer:
// they return a SendResult classifying the failure so the queue can decide whether a retry makes sense.

export type FailureClass = "RETRYABLE" | "PERMANENT";

export interface OutboundMessage {
  to: string; // destination resolved SERVER-SIDE from the recipient's own record - never taken from a request
  body: string;
  subject?: string;
  html?: string;
  purpose?: string; // used only to decide log redaction (OTP)
  correlationId?: string;
  language?: string;
  sender?: string | null; // from-address / from-number / phone-number-id label
}

export interface OutboundTemplateMessage extends OutboundMessage {
  providerTemplateName: string;
  providerTemplateLanguage: string;
  templateParams: string[]; // positional parameters for provider-approved templates
}

export interface SendResult {
  ok: boolean;
  providerMessageId?: string;
  failureClass?: FailureClass;
  error?: string;
  // The provider accepted the request but says the recipient / content can never be delivered.
  rejected?: boolean;
}

export interface RecipientValidation {
  valid: boolean;
  normalized?: string;
  reason?: string;
}

export interface WebhookRequestData {
  rawBody: string;
  headers: Record<string, string | undefined>;
  url: string;
}

export interface WebhookVerification {
  valid: boolean;
  reason?: string;
}

// One normalized status event. `status` is null for events that do not change delivery state.
export interface ParsedWebhookEvent {
  eventId: string; // unique per provider event - the idempotency key
  providerMessageId: string;
  status: DeliveryStatus | null;
  occurredAt: Date | null; // provider-reported time when it gives one (used for the replay window)
  failureReason?: string;
  suppress?: "BOUNCE" | "COMPLAINT" | "UNSUBSCRIBED"; // asks the suppression service to record a suppression
}

export interface ProviderHealth {
  status: "HEALTHY" | "DEGRADED" | "DOWN" | "UNKNOWN";
  latencyMs?: number;
  detail?: string;
}

export interface CommunicationProvider {
  readonly adapterKey: string; // EMAIL_SMTP | SMS_TWILIO | WHATSAPP_META | SANDBOX | INAPP
  readonly channel: NotificationChannel;
  // True only when this adapter would talk to a real external service (env credentials present).
  isConfigured(): boolean;
  // SANDBOX / INAPP never leave the system; real adapters may be blocked in non-production by the environment guard.
  readonly external: boolean;

  sendMessage(msg: OutboundMessage): Promise<SendResult>;
  sendTemplate(msg: OutboundTemplateMessage): Promise<SendResult>;
  sendTransactional(msg: OutboundMessage): Promise<SendResult>;
  sendOTP(msg: OutboundMessage): Promise<SendResult>;
  sendBulk(msgs: OutboundMessage[]): Promise<SendResult[]>;
  // Not every provider can answer this; `supported: false` means "ask the webhook instead" - never guess a status.
  getMessageStatus(providerMessageId: string): Promise<{ supported: boolean; status: DeliveryStatus | null }>;
  verifyWebhook(req: WebhookRequestData): WebhookVerification;
  parseWebhookEvent(req: WebhookRequestData): ParsedWebhookEvent[] | null;
  validateRecipient(to: string): RecipientValidation;
  checkProviderHealth(): Promise<ProviderHealth>;
}

export type EnvMap = Record<string, string | undefined>;
