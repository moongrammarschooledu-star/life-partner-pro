import type { DeliveryStatus } from "@prisma/client";
import { classifyHttpFailure, defaultBulk, hmacHex, normalizePhone, safeEqual } from "@/lib/communications/providers/shared";
import type { CommunicationProvider, EnvMap, OutboundMessage, OutboundTemplateMessage, ParsedWebhookEvent, ProviderHealth, RecipientValidation, SendResult, WebhookRequestData, WebhookVerification } from "@/lib/communications/providers/types";

// WhatsAppProviderAdapter - the OFFICIAL Meta WhatsApp Business Cloud API. There is no scraping, no unofficial client and no
// browser automation anywhere in this codebase. Business-initiated messages MUST use a provider-approved template, so free-text
// sends are refused outright here rather than "trying" and hoping the 24-hour window happens to be open.
//
// Recipient privacy: the destination is the recipient's OWN WhatsApp number, resolved server-side. The SENDER is the platform's
// business number (phone-number-id). A message never carries another person's number - the send service checks that too.
const TIMEOUT_MS = 10_000;

const PERMANENT_ERROR_CODES = new Set([131026, 131047, 131051, 131052, 132000, 132001, 132005, 132007, 132012, 470]);
const RATE_LIMIT_CODES = new Set([130429, 131048, 131056, 80007]);

const STATUS_MAP: Record<string, DeliveryStatus | null> = { sent: "SENT", delivered: "DELIVERED", read: "READ", failed: "FAILED", deleted: null };

export class WhatsAppProviderAdapter implements CommunicationProvider {
  readonly adapterKey = "WHATSAPP_META";
  readonly channel = "WHATSAPP" as const;
  readonly external = true;

  constructor(private env: EnvMap = process.env) {}

  isConfigured(): boolean {
    // WHATSAPP_ENABLED is the module-level env switch that already existed; both it and the credentials are required.
    return this.env.WHATSAPP_ENABLED === "true" && Boolean(this.env.WHATSAPP_ACCESS_TOKEN?.trim() && this.env.WHATSAPP_PHONE_NUMBER_ID?.trim());
  }

  private endpoint(path: string): string {
    const version = this.env.WHATSAPP_API_VERSION?.trim() || "v20.0";
    return `https://graph.facebook.com/${version}/${path}`;
  }

  async sendTemplate(msg: OutboundTemplateMessage): Promise<SendResult> {
    const check = this.validateRecipient(msg.to);
    if (!check.valid) return { ok: false, failureClass: "PERMANENT", rejected: true, error: `INVALID_RECIPIENT:${check.reason}` };
    if (!this.isConfigured()) return { ok: false, failureClass: "PERMANENT", error: "WHATSAPP_PROVIDER_NOT_CONFIGURED" };
    if (!msg.providerTemplateName) return { ok: false, failureClass: "PERMANENT", error: "WHATSAPP_REQUIRES_APPROVED_TEMPLATE" };

    const payload = {
      messaging_product: "whatsapp",
      to: (check.normalized as string).replace("+", ""),
      type: "template",
      template: {
        name: msg.providerTemplateName,
        language: { code: msg.providerTemplateLanguage || "en" },
        ...(msg.templateParams.length ? { components: [{ type: "body", parameters: msg.templateParams.map((text) => ({ type: "text", text })) }] } : {}),
      },
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(this.endpoint(`${encodeURIComponent(this.env.WHATSAPP_PHONE_NUMBER_ID as string)}/messages`), {
        method: "POST",
        headers: { Authorization: `Bearer ${this.env.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const json = (await res.json().catch(() => ({}))) as { messages?: Array<{ id?: string }>; error?: { code?: number; message?: string } };
      const id = json.messages?.[0]?.id;
      if (res.ok && id) return { ok: true, providerMessageId: id };
      const code = json.error?.code;
      if (res.status === 401 || code === 190) return { ok: false, failureClass: "PERMANENT", error: "PROVIDER_AUTHENTICATION_FAILED" };
      if (typeof code === "number" && RATE_LIMIT_CODES.has(code)) return { ok: false, failureClass: "RETRYABLE", error: `WHATSAPP_RATE_LIMIT_${code}` };
      if (typeof code === "number" && PERMANENT_ERROR_CODES.has(code)) return { ok: false, failureClass: "PERMANENT", rejected: true, error: `WHATSAPP_${code}` };
      return { ok: false, failureClass: classifyHttpFailure(res.status), error: `WHATSAPP_HTTP_${res.status}${code ? `_${code}` : ""}` };
    } catch (error) {
      return { ok: false, failureClass: "RETRYABLE", error: error instanceof Error && error.name === "AbortError" ? "PROVIDER_TIMEOUT" : "PROVIDER_NETWORK_ERROR" };
    } finally {
      clearTimeout(timer);
    }
  }

  // Free-text business-initiated WhatsApp is not permitted by the platform, so it is not offered.
  async sendMessage(_msg?: OutboundMessage): Promise<SendResult> { // eslint-disable-line @typescript-eslint/no-unused-vars
    return { ok: false, failureClass: "PERMANENT", error: "WHATSAPP_REQUIRES_APPROVED_TEMPLATE" };
  }
  sendTransactional = (msg: OutboundMessage) => this.sendMessage(msg);
  sendOTP = (msg: OutboundMessage) => this.sendMessage(msg);
  sendBulk = (msgs: OutboundMessage[]) => defaultBulk(() => this.sendMessage(), msgs);

  async getMessageStatus(): Promise<{ supported: boolean; status: DeliveryStatus | null }> {
    return { supported: false, status: null }; // the Cloud API reports status only through webhooks
  }

  // Meta signs the raw body: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(app secret, body).
  verifyWebhook(req: WebhookRequestData): WebhookVerification {
    const secret = this.env.WHATSAPP_APP_SECRET?.trim();
    if (!secret) return { valid: false, reason: "WEBHOOK_SECRET_NOT_CONFIGURED" };
    const header = req.headers["x-hub-signature-256"];
    if (!header || !header.startsWith("sha256=")) return { valid: false, reason: "MISSING_SIGNATURE" };
    return safeEqual(header.slice(7), hmacHex(secret, req.rawBody)) ? { valid: true } : { valid: false, reason: "BAD_SIGNATURE" };
  }

  // The GET subscription handshake (hub.mode / hub.verify_token / hub.challenge) - returns the challenge only for the right token.
  verifyHandshake(params: URLSearchParams): string | null {
    const expected = this.env.WHATSAPP_VERIFY_TOKEN?.trim();
    if (!expected || params.get("hub.mode") !== "subscribe") return null;
    const token = params.get("hub.verify_token");
    return token && safeEqual(token, expected) ? (params.get("hub.challenge") ?? null) : null;
  }

  parseWebhookEvent(req: WebhookRequestData): ParsedWebhookEvent[] | null {
    let json: { entry?: Array<{ changes?: Array<{ value?: { statuses?: Array<{ id?: string; status?: string; timestamp?: string; errors?: Array<{ code?: number; title?: string }> }> } }> }> };
    try {
      json = JSON.parse(req.rawBody);
    } catch {
      return null;
    }
    if (!Array.isArray(json.entry)) return null;
    const out: ParsedWebhookEvent[] = [];
    for (const entry of json.entry) {
      for (const change of entry.changes ?? []) {
        for (const s of change.value?.statuses ?? []) {
          const status = (s.status ?? "").toLowerCase();
          if (!s.id || !(status in STATUS_MAP)) continue;
          const seconds = Number(s.timestamp);
          const occurredAt = Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null;
          out.push({
            eventId: `${s.id}:${status}:${s.timestamp ?? ""}`,
            providerMessageId: s.id,
            status: STATUS_MAP[status],
            occurredAt,
            failureReason: s.errors?.[0] ? `WHATSAPP_${s.errors[0].code ?? "ERR"}` : undefined,
          });
        }
      }
    }
    return out.length ? out : null; // messages / other change types carry no delivery state
  }

  validateRecipient(to: string): RecipientValidation {
    return normalizePhone(to);
  }

  async checkProviderHealth(): Promise<ProviderHealth> {
    if (!this.isConfigured()) return { status: "DOWN", detail: "WhatsApp credentials are not configured." };
    const started = Date.now();
    try {
      const res = await fetch(this.endpoint(encodeURIComponent(this.env.WHATSAPP_PHONE_NUMBER_ID as string)), { headers: { Authorization: `Bearer ${this.env.WHATSAPP_ACCESS_TOKEN}` } });
      const latencyMs = Date.now() - started;
      if (res.status === 401 || res.status === 403) return { status: "DOWN", latencyMs, detail: "AUTHENTICATION_FAILURE" };
      return res.ok ? { status: latencyMs > 3000 ? "DEGRADED" : "HEALTHY", latencyMs } : { status: "DEGRADED", latencyMs, detail: `HTTP ${res.status}` };
    } catch {
      return { status: "DOWN", detail: "Provider unreachable." };
    }
  }
}
