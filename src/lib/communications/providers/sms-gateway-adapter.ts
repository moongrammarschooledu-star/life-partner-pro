import type { DeliveryStatus } from "@prisma/client";
import { classifyHttpFailure, defaultBulk, normalizePhone, templateToText } from "@/lib/communications/providers/shared";
import type { CommunicationProvider, EnvMap, OutboundMessage, ParsedWebhookEvent, ProviderHealth, RecipientValidation, SendResult, WebhookRequestData, WebhookVerification } from "@/lib/communications/providers/types";

// SmsGatewayAdapter - a configurable adapter for an ordinary HTTP SMS gateway (the kind a local Pakistani SMS provider offers): one HTTPS address that
// sends a text when called with the recipient and the message. Nothing about the provider is written in code: the address, method, body, headers,
// sender name and how to recognise success all come from SERVER environment variables, so a different gateway needs no new code. Credentials live
// in those variables (inside the address, the body or a header) and are never returned, logged or stored.
//
//   SMS_GATEWAY_URL            https address; may contain {to} {message} {sender}
//   SMS_GATEWAY_METHOD         GET or POST (default POST)
//   SMS_GATEWAY_BODY           for POST: the body, with {to} {message} {sender}
//   SMS_GATEWAY_CONTENT_TYPE   default application/x-www-form-urlencoded; application/json is also supported
//   SMS_GATEWAY_HEADERS        optional JSON object of extra headers, for example {"Authorization":"Bearer ..."}
//   SMS_GATEWAY_SENDER         the sender name or number the gateway has approved for you
//   SMS_GATEWAY_RECIPIENT_FORMAT   digits (923001234567, the default), e164 (+923001234567) or local (03001234567)
//   SMS_GATEWAY_SUCCESS_PATTERN    optional regular expression that the gateway's reply must match (otherwise any 2xx reply counts)
//   SMS_GATEWAY_FAILURE_PATTERN    optional regular expression that marks a reply as a refusal even if it is a 2xx
//   SMS_GATEWAY_MESSAGE_ID_PATTERN optional regular expression whose first group is the gateway's message id

const TIMEOUT_MS = 10_000;
const MAX_REPLY_CHARS = 2_000;

type Format = "digits" | "e164" | "local";

export class SmsGatewayAdapter implements CommunicationProvider {
  readonly adapterKey = "SMS_GATEWAY";
  readonly channel = "SMS" as const;
  readonly external = true;

  constructor(private env: EnvMap = process.env) {}

  isConfigured(): boolean {
    const url = this.env.SMS_GATEWAY_URL?.trim();
    if (!url) return false;
    try {
      return new URL(url.replace(/\{(to|message|sender)\}/g, "x")).protocol === "https:";
    } catch {
      return false;
    }
  }

  private recipient(e164: string): string {
    const format = (this.env.SMS_GATEWAY_RECIPIENT_FORMAT?.trim().toLowerCase() || "digits") as Format;
    if (format === "e164") return e164;
    if (format === "local") return e164.startsWith("+92") ? `0${e164.slice(3)}` : e164;
    return e164.replace("+", "");
  }

  /** Substitutes {to}, {message} and {sender} in a template, encoded for where it goes. */
  private fill(template: string, values: { to: string; message: string; sender: string }, mode: "url" | "json" | "raw"): string {
    return template.replace(/\{(to|message|sender)\}/g, (_, key: "to" | "message" | "sender") => {
      const v = values[key];
      if (mode === "url") return encodeURIComponent(v);
      if (mode === "json") return JSON.stringify(v).slice(1, -1);
      return v;
    });
  }

  private pattern(source: string | undefined): RegExp | null {
    if (!source?.trim()) return null;
    try {
      return new RegExp(source, "i");
    } catch {
      return null;
    }
  }

  async sendMessage(msg: OutboundMessage): Promise<SendResult> {
    const check = this.validateRecipient(msg.to);
    if (!check.valid) return { ok: false, failureClass: "PERMANENT", rejected: true, error: `INVALID_RECIPIENT:${check.reason}` };
    if (!this.isConfigured()) return { ok: false, failureClass: "PERMANENT", error: "SMS_PROVIDER_NOT_CONFIGURED" };

    const values = { to: this.recipient(check.normalized as string), message: msg.body, sender: (msg.sender || this.env.SMS_GATEWAY_SENDER || "").trim() };
    const method = this.env.SMS_GATEWAY_METHOD?.trim().toUpperCase() === "GET" ? "GET" : "POST";
    const contentType = this.env.SMS_GATEWAY_CONTENT_TYPE?.trim() || "application/x-www-form-urlencoded";
    const json = contentType.toLowerCase().includes("json");
    const url = this.fill(this.env.SMS_GATEWAY_URL as string, values, "url");

    const headers: Record<string, string> = {};
    if (this.env.SMS_GATEWAY_HEADERS?.trim()) {
      try {
        const parsed = JSON.parse(this.env.SMS_GATEWAY_HEADERS) as Record<string, unknown>;
        for (const [k, v] of Object.entries(parsed)) if (/^[A-Za-z0-9-]{1,40}$/.test(k) && typeof v === "string" && !/[\r\n]/.test(v)) headers[k] = this.fill(v, values, "raw");
      } catch {
        return { ok: false, failureClass: "PERMANENT", error: "SMS_GATEWAY_HEADERS_INVALID" };
      }
    }
    let body: string | undefined;
    if (method === "POST") {
      headers["Content-Type"] = contentType;
      body = this.fill(this.env.SMS_GATEWAY_BODY ?? "", values, json ? "json" : "url");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { method, headers, body, signal: controller.signal, redirect: "error" });
      const text = (await res.text().catch(() => "")).slice(0, MAX_REPLY_CHARS);
      if (res.status === 401 || res.status === 403) return { ok: false, failureClass: "PERMANENT", error: "PROVIDER_AUTHENTICATION_FAILED" };
      if (!res.ok) return { ok: false, failureClass: classifyHttpFailure(res.status), error: `SMS_GATEWAY_HTTP_${res.status}` };
      const failure = this.pattern(this.env.SMS_GATEWAY_FAILURE_PATTERN);
      if (failure && failure.test(text)) return { ok: false, failureClass: "PERMANENT", rejected: true, error: "SMS_GATEWAY_REFUSED" };
      const success = this.pattern(this.env.SMS_GATEWAY_SUCCESS_PATTERN);
      if (success && !success.test(text)) return { ok: false, failureClass: "PERMANENT", error: "SMS_GATEWAY_NOT_ACCEPTED" };
      const idPattern = this.pattern(this.env.SMS_GATEWAY_MESSAGE_ID_PATTERN);
      const id = idPattern ? idPattern.exec(text)?.[1] : undefined;
      return { ok: true, providerMessageId: id ? id.slice(0, 120) : undefined };
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

  // A plain gateway cannot be asked about a message later and sends no signed reports: a status is never guessed.
  async getMessageStatus(): Promise<{ supported: boolean; status: DeliveryStatus | null }> {
    return { supported: false, status: null };
  }
  verifyWebhook(_req: WebhookRequestData): WebhookVerification { // eslint-disable-line @typescript-eslint/no-unused-vars
    return { valid: false, reason: "WEBHOOKS_NOT_SUPPORTED" };
  }
  parseWebhookEvent(_req: WebhookRequestData): ParsedWebhookEvent[] | null { // eslint-disable-line @typescript-eslint/no-unused-vars
    return null;
  }

  validateRecipient(to: string): RecipientValidation {
    return normalizePhone(to);
  }

  async checkProviderHealth(): Promise<ProviderHealth> {
    return this.isConfigured() ? { status: "UNKNOWN", detail: "Gateway settings are present (delivery is not probed: a probe would send a message)" } : { status: "UNKNOWN", detail: "Not configured" };
  }
}
