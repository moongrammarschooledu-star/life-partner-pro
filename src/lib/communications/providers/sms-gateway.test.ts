import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: { communicationProvider: { findMany: vi.fn() }, complianceProcessor: { findUnique: vi.fn() } } }));

import { SmsGatewayAdapter } from "@/lib/communications/providers/sms-gateway-adapter";
import { WhatsAppProviderAdapter } from "@/lib/communications/providers/whatsapp-adapter";

// STEP 38 - the configurable SMS gateway adapter and the WhatsApp one-time-code template (fetch is mocked; nothing leaves the machine).

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const reply = (status: number, text: string) => ({ ok: status >= 200 && status < 300, status, text: async () => text });
const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

const GET_GATEWAY = { SMS_GATEWAY_URL: "https://sms.example.pk/send?key=K&to={to}&from={sender}&text={message}", SMS_GATEWAY_METHOD: "GET", SMS_GATEWAY_SENDER: "LifePartner" };
const POST_GATEWAY = {
  SMS_GATEWAY_URL: "https://sms.example.pk/api",
  SMS_GATEWAY_METHOD: "POST",
  SMS_GATEWAY_CONTENT_TYPE: "application/json",
  SMS_GATEWAY_BODY: '{"to":"{to}","from":"{sender}","text":"{message}"}',
  SMS_GATEWAY_HEADERS: '{"Authorization":"Bearer tok"}',
  SMS_GATEWAY_SENDER: "LPP",
};
const TO = "+923001234567";

describe("SMS gateway adapter", () => {
  it("is not configured without an https address and refuses to send", async () => {
    expect(new SmsGatewayAdapter({}).isConfigured()).toBe(false);
    expect(new SmsGatewayAdapter({ SMS_GATEWAY_URL: "http://plain.example/send" }).isConfigured()).toBe(false);
    const r = await new SmsGatewayAdapter({}).sendOTP({ to: TO, body: "x" });
    expect(r).toMatchObject({ ok: false, error: "SMS_PROVIDER_NOT_CONFIGURED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fills a GET address with the recipient, sender and encoded message", async () => {
    fetchMock.mockResolvedValue(reply(200, "OK"));
    const r = await new SmsGatewayAdapter(GET_GATEWAY).sendOTP({ to: "+92 300 1234567", body: "Code 123456 & more" });
    expect(r.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://sms.example.pk/send?key=K&to=923001234567&from=LifePartner&text=Code%20123456%20%26%20more");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(init.redirect).toBe("error");
  });

  it("sends a JSON POST with the custom header, escaping the message", async () => {
    fetchMock.mockResolvedValue(reply(200, '{"status":"ok","id":"m-77"}'));
    const a = new SmsGatewayAdapter({ ...POST_GATEWAY, SMS_GATEWAY_RECIPIENT_FORMAT: "e164", SMS_GATEWAY_MESSAGE_ID_PATTERN: '"id":"([^"]+)"' });
    const r = await a.sendOTP({ to: TO, body: 'Say "hi"' });
    expect(r).toEqual({ ok: true, providerMessageId: "m-77" });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toMatchObject({ "Content-Type": "application/json", Authorization: "Bearer tok" });
    expect(JSON.parse(init.body)).toEqual({ to: TO, from: "LPP", text: 'Say "hi"' });
  });

  it("supports the local (03xx) recipient format", async () => {
    fetchMock.mockResolvedValue(reply(200, "OK"));
    await new SmsGatewayAdapter({ ...GET_GATEWAY, SMS_GATEWAY_RECIPIENT_FORMAT: "local" }).sendOTP({ to: TO, body: "x" });
    expect(fetchMock.mock.calls[0][0]).toContain("to=03001234567");
  });

  it("never sends to a number without a country code", async () => {
    const r = await new SmsGatewayAdapter(GET_GATEWAY).sendOTP({ to: "03001234567", body: "x" });
    expect(r).toMatchObject({ ok: false, rejected: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a 2xx reply as a refusal when it matches the failure pattern, and as not accepted when it misses the success pattern", async () => {
    fetchMock.mockResolvedValue(reply(200, "ERROR: low balance"));
    expect(await new SmsGatewayAdapter({ ...GET_GATEWAY, SMS_GATEWAY_FAILURE_PATTERN: "error" }).sendOTP({ to: TO, body: "x" })).toMatchObject({ ok: false, error: "SMS_GATEWAY_REFUSED" });
    expect(await new SmsGatewayAdapter({ ...GET_GATEWAY, SMS_GATEWAY_SUCCESS_PATTERN: "^OK" }).sendOTP({ to: TO, body: "x" })).toMatchObject({ ok: false, error: "SMS_GATEWAY_NOT_ACCEPTED" });
  });

  it("classifies authentication, server and network failures", async () => {
    const a = new SmsGatewayAdapter(GET_GATEWAY);
    fetchMock.mockResolvedValueOnce(reply(401, "no"));
    expect(await a.sendOTP({ to: TO, body: "x" })).toMatchObject({ ok: false, failureClass: "PERMANENT", error: "PROVIDER_AUTHENTICATION_FAILED" });
    fetchMock.mockResolvedValueOnce(reply(503, "down"));
    expect(await a.sendOTP({ to: TO, body: "x" })).toMatchObject({ ok: false, failureClass: "RETRYABLE" });
    fetchMock.mockRejectedValueOnce(new Error("socket"));
    expect(await a.sendOTP({ to: TO, body: "x" })).toMatchObject({ ok: false, failureClass: "RETRYABLE", error: "PROVIDER_NETWORK_ERROR" });
  });

  it("rejects malformed custom headers instead of sending", async () => {
    const r = await new SmsGatewayAdapter({ ...POST_GATEWAY, SMS_GATEWAY_HEADERS: "{not json" }).sendOTP({ to: TO, body: "x" });
    expect(r).toMatchObject({ ok: false, error: "SMS_GATEWAY_HEADERS_INVALID" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("drops header names or values that could inject a line", async () => {
    fetchMock.mockResolvedValue(reply(200, "OK"));
    const headers = JSON.stringify({ "X-Ok": "fine", "Bad Name": "x", "X-Evil": "a\r\nInjected: 1" });
    await new SmsGatewayAdapter({ ...GET_GATEWAY, SMS_GATEWAY_HEADERS: headers }).sendOTP({ to: TO, body: "x" });
    const sent = fetchMock.mock.calls[0][1].headers;
    expect(sent["X-Ok"]).toBe("fine");
    expect(sent["Bad Name"]).toBeUndefined();
    expect(sent["X-Evil"]).toBeUndefined();
  });

  it("has no webhooks and never invents a delivery status", async () => {
    const a = new SmsGatewayAdapter(GET_GATEWAY);
    expect(a.verifyWebhook({ headers: {}, rawBody: "{}", url: "https://x" } as never)).toMatchObject({ valid: false });
    expect(await a.getMessageStatus()).toEqual({ supported: false, status: null });
  });
});

describe("WhatsApp one-time code (authentication template)", () => {
  const META = { WHATSAPP_ENABLED: "true", WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "1234", WHATSAPP_OTP_TEMPLATE_NAME: "login_code" };

  it("sends the code as the template body parameter and the copy-code button", async () => {
    fetchMock.mockResolvedValue(json(200, { messages: [{ id: "wamid.9" }] }));
    const r = await new WhatsAppProviderAdapter(META).sendOTP({ to: TO, body: "ignored", otpCode: "482913" });
    expect(r).toEqual({ ok: true, providerMessageId: "wamid.9" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.template).toMatchObject({ name: "login_code", language: { code: "en" } });
    expect(body.template.components).toEqual([
      { type: "body", parameters: [{ type: "text", text: "482913" }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "482913" }] },
    ]);
  });

  it("omits the button when the template has none, and uses the configured language", async () => {
    fetchMock.mockResolvedValue(json(200, { messages: [{ id: "w" }] }));
    await new WhatsAppProviderAdapter({ ...META, WHATSAPP_OTP_TEMPLATE_BUTTON: "false", WHATSAPP_OTP_TEMPLATE_LANGUAGE: "ur" }).sendOTP({ to: TO, body: "x", otpCode: "111222" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.template.language.code).toBe("ur");
    expect(body.template.components).toHaveLength(1);
  });

  it("does not send without an approved template name or without a plain code", async () => {
    expect(await new WhatsAppProviderAdapter({ ...META, WHATSAPP_OTP_TEMPLATE_NAME: "" }).sendOTP({ to: TO, body: "x", otpCode: "123456" })).toMatchObject({ ok: false, error: "WHATSAPP_OTP_TEMPLATE_NOT_CONFIGURED" });
    expect(await new WhatsAppProviderAdapter(META).sendOTP({ to: TO, body: "x" })).toMatchObject({ ok: false, error: "WHATSAPP_OTP_CODE_MISSING" });
    expect(await new WhatsAppProviderAdapter(META).sendOTP({ to: TO, body: "x", otpCode: "12 3;--" })).toMatchObject({ ok: false, error: "WHATSAPP_OTP_CODE_MISSING" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
