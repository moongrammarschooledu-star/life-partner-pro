import { createHmac, timingSafeEqual } from "crypto";
import type { DeliveryStatus } from "@prisma/client";
import type { FailureClass, OutboundMessage, OutboundTemplateMessage, ParsedWebhookEvent, SendResult } from "@/lib/communications/providers/types";

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function hmacHex(secret: string, data: string, algo: "sha256" | "sha1" = "sha256"): string {
  return createHmac(algo, secret).update(data).digest("hex");
}

export function hmacBase64(secret: string, data: string, algo: "sha256" | "sha1" = "sha1"): string {
  return createHmac(algo, secret).update(data).digest("base64");
}

// Phone normalization: keep digits and a leading +, require an international number (E.164-ish, 8-15 digits).
// A national number with a leading 0 is NOT guessed into an international one - the recipient record must hold the country code.
export function normalizePhone(raw: string): { valid: boolean; normalized?: string; reason?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { valid: false, reason: "EMPTY" };
  const plus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!plus && digits.startsWith("00")) return normalizePhone("+" + digits.slice(2));
  if (!plus) return { valid: false, reason: "MISSING_COUNTRY_CODE" };
  if (digits.length < 8 || digits.length > 15) return { valid: false, reason: "BAD_LENGTH" };
  if (digits.startsWith("0")) return { valid: false, reason: "BAD_COUNTRY_CODE" };
  return { valid: true, normalized: "+" + digits };
}

export function validateEmailAddress(raw: string): { valid: boolean; normalized?: string; reason?: string } {
  const v = raw.trim().toLowerCase();
  if (v.length > 254 || /[\r\n,;<>]/.test(v)) return { valid: false, reason: "BAD_FORMAT" }; // blocks header injection / multi-recipient tricks
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return { valid: false, reason: "BAD_FORMAT" };
  return { valid: true, normalized: v };
}

// HTTP status -> retry decision. 429 and 5xx (and network errors) are worth another attempt; other 4xx never are.
export function classifyHttpFailure(status: number): FailureClass {
  return status === 429 || status >= 500 || status === 408 ? "RETRYABLE" : "PERMANENT";
}

// ---------- generic signed webhook envelope (email forwarders, sandbox, simulate) ----------
// signature = hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`), headers x-webhook-timestamp (unix seconds) and
// x-webhook-signature. The timestamp is part of the signed string AND must be within the tolerance, so a captured request
// cannot be replayed later (the event id in the DB gives the second, permanent replay defence).
export const ENVELOPE_TOLERANCE_SECONDS = 300;

export function signEnvelope(secret: string, rawBody: string, timestamp: number): string {
  return hmacHex(secret, `${timestamp}.${rawBody}`);
}

export function verifyEnvelope(headers: Record<string, string | undefined>, rawBody: string, secret: string | undefined, now: number = Date.now(), toleranceSeconds: number = ENVELOPE_TOLERANCE_SECONDS): { valid: boolean; reason?: string } {
  if (!secret) return { valid: false, reason: "WEBHOOK_SECRET_NOT_CONFIGURED" }; // fail CLOSED: no secret never means "accept"
  const signature = headers["x-webhook-signature"];
  const ts = Number(headers["x-webhook-timestamp"]);
  if (!signature || !Number.isFinite(ts)) return { valid: false, reason: "MISSING_SIGNATURE_OR_TIMESTAMP" };
  if (Math.abs(now / 1000 - ts) > toleranceSeconds) return { valid: false, reason: "TIMESTAMP_OUT_OF_WINDOW" };
  return safeEqual(signature, signEnvelope(secret, rawBody, ts)) ? { valid: true } : { valid: false, reason: "BAD_SIGNATURE" };
}

const ENVELOPE_STATUS: Record<string, DeliveryStatus | null> = {
  queued: null,
  processed: null,
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
  bounce: "BOUNCED",
  bounced: "BOUNCED",
  rejected: "REJECTED",
  expired: "EXPIRED",
  complaint: null,
  unsubscribe: null,
  unsubscribed: null,
};

export function parseEnvelopeEvents(rawBody: string): ParsedWebhookEvent[] | null {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const events = (json as { events?: unknown }).events;
  if (!Array.isArray(events) || events.length === 0 || events.length > 200) return null;
  const out: ParsedWebhookEvent[] = [];
  for (const e of events as Array<Record<string, unknown>>) {
    const type = typeof e.type === "string" ? e.type.toLowerCase() : "";
    if (typeof e.eventId !== "string" || !e.eventId || typeof e.messageId !== "string" || !e.messageId || !(type in ENVELOPE_STATUS)) return null;
    const ts = typeof e.timestamp === "number" ? new Date(e.timestamp * 1000) : null;
    out.push({
      eventId: e.eventId.slice(0, 200),
      providerMessageId: e.messageId.slice(0, 200),
      status: ENVELOPE_STATUS[type],
      occurredAt: ts && !Number.isNaN(ts.getTime()) ? ts : null,
      failureReason: typeof e.reason === "string" ? e.reason.slice(0, 200) : undefined,
      suppress: type === "complaint" ? "COMPLAINT" : type === "bounce" || type === "bounced" ? "BOUNCE" : type === "unsubscribe" || type === "unsubscribed" ? "UNSUBSCRIBED" : undefined,
    });
  }
  return out;
}

// Adapters that have no separate OTP / bulk / template path delegate to sendMessage.
export async function defaultBulk(send: (m: OutboundMessage) => Promise<SendResult>, msgs: OutboundMessage[]): Promise<SendResult[]> {
  const out: SendResult[] = [];
  for (const m of msgs) out.push(await send(m));
  return out;
}

export function templateToText(msg: OutboundTemplateMessage): OutboundMessage {
  return { to: msg.to, body: msg.body, subject: msg.subject, html: msg.html, purpose: msg.purpose, correlationId: msg.correlationId, language: msg.language, sender: msg.sender };
}

// Console/log output must never contain a raw one-time code in production (spec §19). Outside production it stays readable so
// a developer can complete a flow; COMMUNICATION_DEBUG_OTP=true re-enables it deliberately (e.g. before a real SMS provider exists).
export function redactForLog(body: string, purpose: string | undefined, env: Record<string, string | undefined> = process.env): string {
  const production = (env.APP_ENV ?? env.VERCEL_ENV ?? env.NODE_ENV) === "production";
  const isOtp = purpose === "OTP" || purpose === "VERIFICATION";
  if (!production || env.COMMUNICATION_DEBUG_OTP === "true" || !isOtp) return body;
  return body.replace(/\b[A-Za-z0-9_-]{6,}\b/g, (word) => (/\d{4,}/.test(word) || word.length >= 24 ? "[redacted]" : word));
}
