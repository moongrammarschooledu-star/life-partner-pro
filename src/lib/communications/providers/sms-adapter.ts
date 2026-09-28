import type { DeliveryStatus } from "@prisma/client";
import { classifyHttpFailure, defaultBulk, hmacBase64, normalizePhone, safeEqual, templateToText } from "@/lib/communications/providers/shared";
import type { CommunicationProvider, EnvMap, OutboundMessage, ParsedWebhookEvent, ProviderHealth, RecipientValidation, SendResult, WebhookRequestData, WebhookVerification } from "@/lib/communications/providers/types";

// SmsProviderAdapter - Twilio Programmable Messaging (official REST API). Credentials come ONLY from server environment
// variables; nothing here is ever returned to a client or logged. Not configured => the registry uses the sandbox adapter.
const TIMEOUT_MS = 10_000;

// Twilio error codes that mean "this recipient can never receive this" - no point retrying.
const PERMANENT_CODES = new Set([21211, 21214, 21217, 21408, 21610, 21612, 21614, 21617, 30003, 30005, 30006]);

const STATUS_MAP: Record<string, DeliveryStatus | null> = {
  accepted: null,
  scheduled: null,
  queued: null,
  sending: null,
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  undelivered: "FAILED",
  failed: "FAILED",
  canceled: "CANCELLED",
};

export class SmsProviderAdapter implements CommunicationProvider {
  readonly adapterKey = "SMS_TWILIO";
  readonly channel = "SMS" as const;
  readonly external = true;

  constructor(private env: EnvMap = process.env) {}

  isConfigured(): boolean {
    return Boolean(this.env.TWILIO_ACCOUNT_SID?.trim() && this.env.TWILIO_AUTH_TOKEN?.trim() && (this.env.TWILIO_FROM_NUMBER?.trim() || this.env.TWILIO_MESSAGING_SERVICE_SID?.trim()));
  }

  private auth(): string {
    return "Basic " + Buffer.from(`${this.env.TWILIO_ACCOUNT_SID}:${this.env.TWILIO_AUTH_TOKEN}`).toString("base64");
  }

  private base(): string {
    return `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.env.TWILIO_ACCOUNT_SID as string)}`;
  }

  async sendMessage(msg: OutboundMessage): Promise<SendResult> {
    const check = this.validateRecipient(msg.to);
    if (!check.valid) return { ok: false, failureClass: "PERMANENT", rejected: true, error: `INVALID_RECIPIENT:${check.reason}` };
    if (!this.isConfigured()) return { ok: false, failureClass: "PERMANENT", error: "SMS_PROVIDER_NOT_CONFIGURED" };

    const form = new URLSearchParams({ To: check.normalized as string, Body: msg.body });
    if (this.env.TWILIO_MESSAGING_SERVICE_SID?.trim()) form.set("MessagingServiceSid", this.env.TWILIO_MESSAGING_SERVICE_SID.trim());
    else form.set("From", (msg.sender || (this.env.TWILIO_FROM_NUMBER as string)).trim());
    if (this.env.TWILIO_STATUS_CALLBACK_URL?.trim()) form.set("StatusCallback", this.env.TWILIO_STATUS_CALLBACK_URL.trim());

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${this.base()}/Messages.json`, { method: "POST", headers: { Authorization: this.auth(), "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString(), signal: controller.signal });
      const json = (await res.json().catch(() => ({}))) as { sid?: string; code?: number; message?: string };
      if (res.ok && json.sid) return { ok: true, providerMessageId: json.sid };
      if (typeof json.code === "number" && PERMANENT_CODES.has(json.code)) return { ok: false, failureClass: "PERMANENT", rejected: true, error: `TWILIO_${json.code}` };
      const authFailure = res.status === 401 || res.status === 403;
      return { ok: false, failureClass: authFailure ? "PERMANENT" : classifyHttpFailure(res.status), error: authFailure ? "PROVIDER_AUTHENTICATION_FAILED" : `TWILIO_HTTP_${res.status}${json.code ? `_${json.code}` : ""}` };
    } catch (error) {
      return { ok: false, failureClass: "RETRYABLE", error: error instanceof Error && error.name === "AbortError" ? "PROVIDER_TIMEOUT" : "PROVIDER_NETWORK_ERROR" };
    } finally {
      clearTimeout(timer);
    }
  }

  sendTemplate = (msg: Parameters<CommunicationProvider["sendTemplate"]>[0]) => this.sendMessage(templateToText(msg));
  sendTransactional = (msg: OutboundMessage) => this.sendMessage(msg);
  sendOTP = (msg: OutboundMessage) => this.sendMessage(msg);
  sendBulk = (msgs: OutboundMessage[]) => defaultBulk((m) => this.sendMessage(m), msgs);

  async getMessageStatus(providerMessageId: string): Promise<{ supported: boolean; status: DeliveryStatus | null }> {
    if (!this.isConfigured()) return { supported: false, status: null };
    try {
      const res = await fetch(`${this.base()}/Messages/${encodeURIComponent(providerMessageId)}.json`, { headers: { Authorization: this.auth() } });
      if (!res.ok) return { supported: true, status: null };
      const json = (await res.json()) as { status?: string };
      return { supported: true, status: STATUS_MAP[(json.status ?? "").toLowerCase()] ?? null };
    } catch {
      return { supported: true, status: null };
    }
  }

  // Twilio signs the FULL callback URL followed by every POST parameter (name+value, sorted by name), HMAC-SHA1 with the auth
  // token, base64. There is no timestamp header, so replay defence is the permanent event-id idempotency in the webhook ledger.
  verifyWebhook(req: WebhookRequestData): WebhookVerification {
    const token = this.env.TWILIO_AUTH_TOKEN?.trim();
    if (!token) return { valid: false, reason: "WEBHOOK_SECRET_NOT_CONFIGURED" };
    const signature = req.headers["x-twilio-signature"];
    if (!signature) return { valid: false, reason: "MISSING_SIGNATURE" };
    const url = this.env.TWILIO_WEBHOOK_URL?.trim() || req.url;
    const params = new URLSearchParams(req.rawBody);
    const data = url + [...params.keys()].sort().map((k) => k + (params.get(k) ?? "")).join("");
    return safeEqual(signature, hmacBase64(token, data, "sha1")) ? { valid: true } : { valid: false, reason: "BAD_SIGNATURE" };
  }

  parseWebhookEvent(req: WebhookRequestData): ParsedWebhookEvent[] | null {
    const p = new URLSearchParams(req.rawBody);
    const sid = p.get("MessageSid") ?? p.get("SmsSid");
    const status = (p.get("MessageStatus") ?? p.get("SmsStatus") ?? "").toLowerCase();
    if (!sid || !status || !(status in STATUS_MAP)) return null;
    const errorCode = p.get("ErrorCode");
    return [
      {
        eventId: `${sid}:${status}`,
        providerMessageId: sid,
        status: STATUS_MAP[status],
        occurredAt: null,
        failureReason: errorCode ? `TWILIO_${errorCode}` : undefined,
        suppress: errorCode === "21610" ? "UNSUBSCRIBED" : undefined, // recipient replied STOP
      },
    ];
  }

  validateRecipient(to: string): RecipientValidation {
    return normalizePhone(to);
  }

  async checkProviderHealth(): Promise<ProviderHealth> {
    if (!this.isConfigured()) return { status: "DOWN", detail: "Twilio credentials are not configured." };
    const started = Date.now();
    try {
      const res = await fetch(`${this.base()}.json`, { headers: { Authorization: this.auth() } });
      const latencyMs = Date.now() - started;
      if (res.status === 401 || res.status === 403) return { status: "DOWN", latencyMs, detail: "AUTHENTICATION_FAILURE" };
      return res.ok ? { status: latencyMs > 3000 ? "DEGRADED" : "HEALTHY", latencyMs } : { status: "DEGRADED", latencyMs, detail: `HTTP ${res.status}` };
    } catch {
      return { status: "DOWN", detail: "Provider unreachable." };
    }
  }
}
