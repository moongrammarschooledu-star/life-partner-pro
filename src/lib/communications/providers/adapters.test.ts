import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";

const findManyProviders = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { communicationProvider: { findMany: findManyProviders }, complianceProcessor: { findUnique: vi.fn() } } }));

import { SmsProviderAdapter } from "@/lib/communications/providers/sms-adapter";
import { WhatsAppProviderAdapter } from "@/lib/communications/providers/whatsapp-adapter";
import { SandboxProviderAdapter } from "@/lib/communications/providers/sandbox-adapter";
import { EmailProviderAdapter } from "@/lib/communications/providers/email-adapter";
import { classifyHttpFailure, normalizePhone, redactForLog, signEnvelope, validateEmailAddress, verifyEnvelope } from "@/lib/communications/providers/shared";
import { resolveProviderChain } from "@/lib/communications/providers/registry";

const TWILIO = { TWILIO_ACCOUNT_SID: "ACtest", TWILIO_AUTH_TOKEN: "tw-token", TWILIO_FROM_NUMBER: "+15550001111", TWILIO_WEBHOOK_URL: "https://app.example/api/webhooks/sms" };
const META = { WHATSAPP_ENABLED: "true", WHATSAPP_ACCESS_TOKEN: "meta-token", WHATSAPP_PHONE_NUMBER_ID: "1234", WHATSAPP_APP_SECRET: "app-secret", WHATSAPP_VERIFY_TOKEN: "verify-me" };

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  findManyProviders.mockReset();
  findManyProviders.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllGlobals());

const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe("Twilio SMS adapter (mocked fetch)", () => {
  it("is not configured without credentials and refuses to send", async () => {
    const a = new SmsProviderAdapter({});
    expect(a.isConfigured()).toBe(false);
    expect((await a.sendMessage({ to: "+923001234567", body: "x" })).error).toBe("SMS_PROVIDER_NOT_CONFIGURED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts to the official REST API with basic auth and returns the message sid", async () => {
    fetchMock.mockResolvedValue(json(201, { sid: "SM123" }));
    const r = await new SmsProviderAdapter(TWILIO).sendMessage({ to: "+92 300 1234567", body: "Hello" });
    expect(r).toEqual({ ok: true, providerMessageId: "SM123" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json");
    expect(init.headers.Authorization).toBe("Basic " + Buffer.from("ACtest:tw-token").toString("base64"));
    const form = new URLSearchParams(init.body);
    expect(form.get("To")).toBe("+923001234567");
    expect(form.get("From")).toBe("+15550001111");
    expect(form.get("Body")).toBe("Hello");
  });

  it("never sends to an invalid number", async () => {
    const r = await new SmsProviderAdapter(TWILIO).sendMessage({ to: "0300-1234567", body: "x" });
    expect(r).toMatchObject({ ok: false, failureClass: "PERMANENT", rejected: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("classifies provider failures: invalid number is permanent, 429/5xx/network retryable, auth permanent", async () => {
    const a = new SmsProviderAdapter(TWILIO);
    fetchMock.mockResolvedValueOnce(json(400, { code: 21211 }));
    expect(await a.sendMessage({ to: "+923001234567", body: "x" })).toMatchObject({ failureClass: "PERMANENT", rejected: true, error: "TWILIO_21211" });
    fetchMock.mockResolvedValueOnce(json(429, {}));
    expect(await a.sendMessage({ to: "+923001234567", body: "x" })).toMatchObject({ failureClass: "RETRYABLE" });
    fetchMock.mockResolvedValueOnce(json(503, {}));
    expect(await a.sendMessage({ to: "+923001234567", body: "x" })).toMatchObject({ failureClass: "RETRYABLE" });
    fetchMock.mockResolvedValueOnce(json(401, {}));
    expect(await a.sendMessage({ to: "+923001234567", body: "x" })).toMatchObject({ failureClass: "PERMANENT", error: "PROVIDER_AUTHENTICATION_FAILED" });
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    expect(await a.sendMessage({ to: "+923001234567", body: "x" })).toMatchObject({ failureClass: "RETRYABLE", error: "PROVIDER_NETWORK_ERROR" });
  });

  it("verifies the Twilio signature (URL + sorted params, HMAC-SHA1) and rejects tampering", () => {
    const a = new SmsProviderAdapter(TWILIO);
    const raw = "MessageSid=SM1&MessageStatus=delivered&To=%2B923001234567";
    const params = new URLSearchParams(raw);
    const data = TWILIO.TWILIO_WEBHOOK_URL + [...params.keys()].sort().map((k) => k + params.get(k)).join("");
    const sig = createHmac("sha1", TWILIO.TWILIO_AUTH_TOKEN).update(data).digest("base64");
    expect(a.verifyWebhook({ rawBody: raw, headers: { "x-twilio-signature": sig }, url: "ignored" })).toEqual({ valid: true });
    expect(a.verifyWebhook({ rawBody: raw + "&extra=1", headers: { "x-twilio-signature": sig }, url: "" }).valid).toBe(false);
    expect(a.verifyWebhook({ rawBody: raw, headers: {}, url: "" }).reason).toBe("MISSING_SIGNATURE");
    expect(new SmsProviderAdapter({}).verifyWebhook({ rawBody: raw, headers: { "x-twilio-signature": sig }, url: "" }).reason).toBe("WEBHOOK_SECRET_NOT_CONFIGURED");
  });

  it("maps webhook statuses without inventing any (queued/sending carry no state, STOP becomes an unsubscribe)", () => {
    const a = new SmsProviderAdapter(TWILIO);
    const ev = (body: string) => a.parseWebhookEvent({ rawBody: body, headers: {}, url: "" });
    expect(ev("MessageSid=SM1&MessageStatus=queued")?.[0].status).toBeNull();
    expect(ev("MessageSid=SM1&MessageStatus=delivered")?.[0]).toMatchObject({ status: "DELIVERED", eventId: "SM1:delivered" });
    expect(ev("MessageSid=SM1&MessageStatus=undelivered&ErrorCode=30003")?.[0]).toMatchObject({ status: "FAILED", failureReason: "TWILIO_30003" });
    expect(ev("MessageSid=SM1&MessageStatus=failed&ErrorCode=21610")?.[0].suppress).toBe("UNSUBSCRIBED");
    expect(ev("garbage")).toBeNull();
    expect(ev("MessageSid=SM1&MessageStatus=teleported")).toBeNull();
  });
});

describe("Meta WhatsApp Cloud API adapter (mocked fetch)", () => {
  it("refuses free-text business-initiated messages: approved templates only", async () => {
    const a = new WhatsAppProviderAdapter(META);
    for (const r of [await a.sendMessage(), await a.sendOTP({ to: "+923001234567", body: "123456" }), await a.sendTransactional({ to: "+923001234567", body: "x" })]) {
      expect(r).toMatchObject({ ok: false, error: "WHATSAPP_REQUIRES_APPROVED_TEMPLATE" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends an approved template through the official Graph API", async () => {
    fetchMock.mockResolvedValue(json(200, { messages: [{ id: "wamid.1" }] }));
    const r = await new WhatsAppProviderAdapter(META).sendTemplate({ to: "+92 300 1234567", body: "", providerTemplateName: "meeting_reminder", providerTemplateLanguage: "en", templateParams: ["Ayesha", "10:00"] });
    expect(r).toEqual({ ok: true, providerMessageId: "wamid.1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v20.0/1234/messages");
    expect(init.headers.Authorization).toBe("Bearer meta-token");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ messaging_product: "whatsapp", to: "923001234567", type: "template", template: { name: "meeting_reminder", language: { code: "en" } } });
    expect(body.template.components[0].parameters).toEqual([{ type: "text", text: "Ayesha" }, { type: "text", text: "10:00" }]);
  });

  it("needs the explicit WHATSAPP_ENABLED switch and credentials", async () => {
    expect(new WhatsAppProviderAdapter({ ...META, WHATSAPP_ENABLED: "false" }).isConfigured()).toBe(false);
    expect(new WhatsAppProviderAdapter({}).isConfigured()).toBe(false);
    const r = await new WhatsAppProviderAdapter({}).sendTemplate({ to: "+923001234567", body: "", providerTemplateName: "t", providerTemplateLanguage: "en", templateParams: [] });
    expect(r.error).toBe("WHATSAPP_PROVIDER_NOT_CONFIGURED");
  });

  it("classifies rate limits as retryable and bad numbers / expired tokens as permanent", async () => {
    const a = new WhatsAppProviderAdapter(META);
    const tpl = { to: "+923001234567", body: "", providerTemplateName: "t", providerTemplateLanguage: "en", templateParams: [] };
    fetchMock.mockResolvedValueOnce(json(400, { error: { code: 130429 } }));
    expect(await a.sendTemplate(tpl)).toMatchObject({ failureClass: "RETRYABLE" });
    fetchMock.mockResolvedValueOnce(json(400, { error: { code: 131026 } }));
    expect(await a.sendTemplate(tpl)).toMatchObject({ failureClass: "PERMANENT", rejected: true });
    fetchMock.mockResolvedValueOnce(json(401, { error: { code: 190 } }));
    expect(await a.sendTemplate(tpl)).toMatchObject({ failureClass: "PERMANENT", error: "PROVIDER_AUTHENTICATION_FAILED" });
  });

  it("verifies X-Hub-Signature-256 and the GET handshake", () => {
    const a = new WhatsAppProviderAdapter(META);
    const raw = JSON.stringify({ entry: [] });
    const sig = "sha256=" + createHmac("sha256", "app-secret").update(raw).digest("hex");
    expect(a.verifyWebhook({ rawBody: raw, headers: { "x-hub-signature-256": sig }, url: "" })).toEqual({ valid: true });
    expect(a.verifyWebhook({ rawBody: raw + " ", headers: { "x-hub-signature-256": sig }, url: "" }).valid).toBe(false);
    expect(a.verifyWebhook({ rawBody: raw, headers: {}, url: "" }).reason).toBe("MISSING_SIGNATURE");
    expect(a.verifyHandshake(new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "42" }))).toBe("42");
    expect(a.verifyHandshake(new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "42" }))).toBeNull();
  });

  it("parses status events with provider timestamps and error codes; ignores inbound-message payloads", () => {
    const a = new WhatsAppProviderAdapter(META);
    const raw = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: "wamid.1", status: "delivered", timestamp: "1760000000" }, { id: "wamid.2", status: "failed", timestamp: "1760000001", errors: [{ code: 131026 }] }] } }] }] });
    const evs = a.parseWebhookEvent({ rawBody: raw, headers: {}, url: "" }) ?? [];
    expect(evs).toHaveLength(2);
    expect(evs[0]).toMatchObject({ status: "DELIVERED", providerMessageId: "wamid.1" });
    expect(evs[0].occurredAt?.getTime()).toBe(1760000000 * 1000);
    expect(evs[1]).toMatchObject({ status: "FAILED", failureReason: "WHATSAPP_131026" });
    expect(a.parseWebhookEvent({ rawBody: JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ text: "hi" }] } }] }] }), headers: {}, url: "" })).toBeNull();
    expect(a.parseWebhookEvent({ rawBody: "nope", headers: {}, url: "" })).toBeNull();
  });
});

describe("signed webhook envelope (e-mail / sandbox)", () => {
  const secret = "s3cret";
  const body = JSON.stringify({ events: [{ eventId: "e1", messageId: "m1", type: "delivered" }] });
  const now = 1_760_000_000_000;
  const ts = Math.floor(now / 1000);

  it("accepts a fresh correctly signed request", () => {
    expect(verifyEnvelope({ "x-webhook-timestamp": String(ts), "x-webhook-signature": signEnvelope(secret, body, ts) }, body, secret, now)).toEqual({ valid: true });
  });
  it("fails closed with no secret, no signature, a bad signature, a tampered body, or a stale / future timestamp (replay)", () => {
    const good = { "x-webhook-timestamp": String(ts), "x-webhook-signature": signEnvelope(secret, body, ts) };
    expect(verifyEnvelope(good, body, undefined, now).reason).toBe("WEBHOOK_SECRET_NOT_CONFIGURED");
    expect(verifyEnvelope({}, body, secret, now).valid).toBe(false);
    expect(verifyEnvelope({ ...good, "x-webhook-signature": "00" }, body, secret, now).valid).toBe(false);
    expect(verifyEnvelope(good, body + " ", secret, now).valid).toBe(false);
    expect(verifyEnvelope(good, body, secret, now + 301_000).reason).toBe("TIMESTAMP_OUT_OF_WINDOW");
    expect(verifyEnvelope(good, body, secret, now - 301_000).reason).toBe("TIMESTAMP_OUT_OF_WINDOW");
    // a valid signature over a DIFFERENT timestamp cannot be re-used with a fresh timestamp header
    expect(verifyEnvelope({ "x-webhook-timestamp": String(ts + 10), "x-webhook-signature": good["x-webhook-signature"] }, body, secret, now).valid).toBe(false);
  });
  it("the e-mail adapter uses EMAIL_WEBHOOK_SECRET and never accepts an unsigned request", () => {
    const a = new EmailProviderAdapter({ EMAIL_WEBHOOK_SECRET: secret });
    const req = { rawBody: body, headers: { "x-webhook-timestamp": String(Math.floor(Date.now() / 1000)), "x-webhook-signature": "bad" }, url: "" };
    expect(a.verifyWebhook(req).valid).toBe(false);
    expect(new EmailProviderAdapter({}).verifyWebhook(req).reason).toBe("WEBHOOK_SECRET_NOT_CONFIGURED");
  });
});

describe("sandbox adapter", () => {
  it("hands messages to the sandbox and never claims delivery", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const a = new SandboxProviderAdapter("SMS", {});
    const r = await a.sendMessage({ to: "+923001234567", body: "hi" });
    expect(r.ok).toBe(true);
    expect(r.providerMessageId).toMatch(/^sandbox-sms-/);
    expect(await a.getMessageStatus()).toEqual({ supported: false, status: null });
    expect(a.external).toBe(false);
    log.mockRestore();
  });
  it("rejects a bad recipient like a real provider would", async () => {
    expect(await new SandboxProviderAdapter("EMAIL", {}).sendMessage({ to: "not-an-email", body: "x" })).toMatchObject({ ok: false, rejected: true });
  });
});

describe("shared helpers", () => {
  it("normalizes phones without guessing a country code", () => {
    expect(normalizePhone("+92 (300) 123-4567")).toEqual({ valid: true, normalized: "+923001234567" });
    expect(normalizePhone("00923001234567")).toEqual({ valid: true, normalized: "+923001234567" });
    expect(normalizePhone("03001234567").reason).toBe("MISSING_COUNTRY_CODE");
    expect(normalizePhone("+123").reason).toBe("BAD_LENGTH");
    expect(normalizePhone("").reason).toBe("EMPTY");
  });
  it("blocks e-mail header injection and multi-recipient tricks", () => {
    expect(validateEmailAddress(" A@B.com ")).toEqual({ valid: true, normalized: "a@b.com" });
    for (const bad of ["a@b.com\r\nBcc: x@y.com", "a@b.com,c@d.com", "a@b.com;c@d.com", "<a@b.com>", "nope", "a@b"]) expect(validateEmailAddress(bad).valid, bad).toBe(false);
  });
  it("classifies HTTP failures for retry", () => {
    expect([429, 500, 502, 503, 408].every((s) => classifyHttpFailure(s) === "RETRYABLE")).toBe(true);
    expect([400, 401, 403, 404, 422].every((s) => classifyHttpFailure(s) === "PERMANENT")).toBe(true);
  });
  it("redacts one-time codes from production logs unless explicitly debugging", () => {
    const body = "Your Life Partner Pro verification code is 482913. It expires in 10 minutes.";
    expect(redactForLog(body, "OTP", { NODE_ENV: "production" })).not.toContain("482913");
    expect(redactForLog(body, "OTP", { NODE_ENV: "production", COMMUNICATION_DEBUG_OTP: "true" })).toContain("482913");
    expect(redactForLog(body, "OTP", { NODE_ENV: "development" })).toContain("482913");
    expect(redactForLog("Your proposal 482913 is ready", "PROPOSAL", { NODE_ENV: "production" })).toContain("482913"); // only OTP-like purposes are redacted
  });
});

describe("provider registry environment guard", () => {
  it("uses the sandbox when nothing is configured", async () => {
    const chain = await resolveProviderChain({ channel: "SMS", destination: "+923001234567", environment: "PRODUCTION", env: {} });
    expect(chain).toHaveLength(1);
    expect(chain[0].adapter.adapterKey).toBe("SANDBOX");
  });
  it("uses the real provider in PRODUCTION when credentials exist", async () => {
    const chain = await resolveProviderChain({ channel: "SMS", destination: "+923001234567", environment: "PRODUCTION", env: TWILIO });
    expect(chain[0].adapter.adapterKey).toBe("SMS_TWILIO");
    expect(chain[0].sandboxed).toBe(false);
  });
  it("outside production routes real providers to the sandbox unless the recipient is an allow-listed test recipient", async () => {
    const env = { ...TWILIO, COMMUNICATION_TEST_RECIPIENTS: "+92 300 0000000" };
    const stranger = await resolveProviderChain({ channel: "SMS", destination: "+923001234567", environment: "STAGING", env });
    expect(stranger[0].adapter.adapterKey).toBe("SANDBOX");
    expect(stranger[0].sandboxed).toBe(true);
    const tester = await resolveProviderChain({ channel: "SMS", destination: "+923000000000", environment: "STAGING", env });
    expect(tester[0].adapter.adapterKey).toBe("SMS_TWILIO");
  });
  it("ignores a provider row from another environment and one whose credentials are missing", async () => {
    findManyProviders.mockResolvedValue([
      { providerKey: "twilio-prod", adapter: "SMS_TWILIO", channel: "SMS", environment: "PRODUCTION", priority: 1, supportedCountries: "[]", supportedLanguages: "[]", failoverAllowed: false, processorId: null },
    ]);
    const chain = await resolveProviderChain({ channel: "SMS", destination: "+923001234567", environment: "STAGING", env: TWILIO });
    expect(chain[0].providerKey).not.toBe("twilio-prod");
    findManyProviders.mockResolvedValue([{ providerKey: "twilio-prod", adapter: "SMS_TWILIO", channel: "SMS", environment: "PRODUCTION", priority: 1, supportedCountries: "[]", supportedLanguages: "[]", failoverAllowed: false, processorId: null }]);
    const noCreds = await resolveProviderChain({ channel: "SMS", destination: "+923001234567", environment: "PRODUCTION", env: {} });
    expect(noCreds[0].adapter.adapterKey).toBe("SANDBOX");
  });
  it("respects a provider's supported countries", async () => {
    findManyProviders.mockResolvedValue([{ providerKey: "twilio-pk", adapter: "SMS_TWILIO", channel: "SMS", environment: "PRODUCTION", priority: 1, supportedCountries: JSON.stringify(["Pakistan"]), supportedLanguages: "[]", failoverAllowed: false, processorId: null }]);
    const pk = await resolveProviderChain({ channel: "SMS", destination: "+923001234567", country: "Pakistan", environment: "PRODUCTION", env: TWILIO });
    expect(pk[0].providerKey).toBe("twilio-pk");
    const other = await resolveProviderChain({ channel: "SMS", destination: "+447700900000", country: "United Kingdom", environment: "PRODUCTION", env: TWILIO });
    expect(other[0].providerKey).not.toBe("twilio-pk");
  });
});
