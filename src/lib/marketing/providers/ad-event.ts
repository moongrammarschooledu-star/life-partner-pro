import { randomUUID } from "crypto";
import type { MarketingEventType } from "@prisma/client";
import type { AdPlatformEvent } from "@/lib/marketing/providers/types";

// STEP 29 §20 — what may leave the system toward an ad platform. The builder takes ONLY an event type and an optional
// campaign reference; it has no parameter through which a lead, applicant, contact detail, score or note could be
// passed in. Four funnel events are mapped; progress events (profile completed, verification…) are deliberately NOT
// sent (data minimisation). The event id is a random UUID — never the lead id.

const EVENT_NAME: Partial<Record<MarketingEventType, string>> = {
  LANDING_PAGE_VIEW: "ViewContent",
  LEAD_CREATED: "Lead",
  WHATSAPP_STARTED: "Contact",
  REGISTRATION_COMPLETED: "CompleteRegistration",
};

export function isSendableEventType(type: MarketingEventType): boolean {
  return type in EVENT_NAME;
}

export function buildAdPlatformEvent(type: MarketingEventType, opts: { campaignRef?: string; now?: Date } = {}): AdPlatformEvent | null {
  const eventName = EVENT_NAME[type];
  if (!eventName) return null;
  const event: AdPlatformEvent = {
    eventName,
    eventTime: Math.floor((opts.now ?? new Date()).getTime() / 1000),
    eventId: randomUUID(),
    actionSource: "website",
  };
  if (opts.campaignRef && /^[A-Za-z0-9_.-]{1,60}$/.test(opts.campaignRef)) event.campaignRef = opts.campaignRef;
  assertNoSensitiveAdPayload(event);
  return event;
}

const SENSITIVE_KEY = /(email|phone|mobile|whatsapp|name|address|city|religion|sect|caste|income|health|dob|birth|cnic|passport|photo|score|risk|note|proposal|match|document|inquiry|lead_?id|profile_?id|user_?data|ip|agent)/i;
const EMAIL_VALUE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const UUID_VALUE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PHONE_VALUE = /\+?\d[\d\s().-]{8,}\d/;

// Recursively refuses any key or value that looks like personal / sensitive matrimonial data. Used by the builder and
// asserted directly in tests so a future edit that widens the payload fails loudly.
export function assertNoSensitiveAdPayload(payload: unknown, path = "event"): void {
  if (payload === null || payload === undefined) return;
  if (typeof payload === "string") {
    if (EMAIL_VALUE.test(payload) || (PHONE_VALUE.test(payload) && payload.replace(/\D/g, "").length >= 10)) throw new Error(`Sensitive value in ad platform payload at ${path}`);
    return;
  }
  if (typeof payload === "number" || typeof payload === "boolean") return;
  if (Array.isArray(payload)) {
    payload.forEach((v, i) => assertNoSensitiveAdPayload(v, `${path}[${i}]`));
    return;
  }
  if (typeof payload === "object") {
    for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
      // "eventName"/"eventTime"/"eventId"/"actionSource"/"campaignRef" are the whole allowed vocabulary.
      if (SENSITIVE_KEY.test(k) && !["eventName"].includes(k)) throw new Error(`Sensitive key "${k}" in ad platform payload`);
      // The event id is OUR random UUID; a run of its digits and dashes can look like a phone number, so it is accepted
      // only when it is exactly a UUID (anything else in that slot is still scanned like any other value).
      if (k === "eventId" && typeof v === "string" && UUID_VALUE.test(v)) continue;
      assertNoSensitiveAdPayload(v, `${path}.${k}`);
    }
  }
}
