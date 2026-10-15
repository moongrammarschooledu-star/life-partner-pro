import { describe, it, expect, vi, beforeEach } from "vitest";

// STEP 38 - phone-first codes: the delivery order, the "real provider only" rule, the fall-through, the sign-in identifier and the optional e-mail.

const flags: Record<string, boolean> = {};
const contactRow = { current: null as null | { mobileNumber: string; whatsappNumber: string | null; email: string | null } };
const chain = vi.hoisted(() => vi.fn());
const sendOtpMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({ prisma: { contactInfo: { findUnique: async () => contactRow.current } } }));
vi.mock("@/lib/ops/feature-flags", () => ({ isFeatureEnabled: async (key: string) => !!flags[key] }));
vi.mock("@/lib/communications/providers/registry", () => ({ resolveProviderChain: chain }));
vi.mock("@/lib/verification/otp-service", () => ({ sendOtp: sendOtpMock }));

const { codeChannelOrder, destinationForChannel, channelIsReal, phoneLoginEnabled, sendContactCode, NoCodeChannelError } = await import("./contact-code");
const { emailRequirementMet } = await import("./email-requirement");

const real = { adapter: { external: true, isConfigured: () => true }, sandboxed: false };
const sandbox = { adapter: { external: false, isConfigured: () => true }, sandboxed: true };

beforeEach(() => {
  for (const k of Object.keys(flags)) delete flags[k];
  chain.mockReset();
  sendOtpMock.mockReset();
  sendOtpMock.mockImplementation(async (_p: string, channel: string) => ({ destinationMasked: channel === "EMAIL" ? "a***@x.com" : "+92•••4567" }));
  contactRow.current = { mobileNumber: "0300 1234567", whatsappNumber: "+92 301 7654321", email: "a@x.com" };
});

describe("code channel order and destinations", () => {
  it("is WhatsApp, SMS, e-mail with phone sign-in on, e-mail only with it off", () => {
    expect(codeChannelOrder(true)).toEqual(["WHATSAPP", "SMS", "EMAIL"]);
    expect(codeChannelOrder(false)).toEqual(["EMAIL"]);
  });

  it("normalises Pakistani numbers to E.164 and returns nothing for a missing destination", () => {
    const c = { mobileNumber: "0300 1234567", whatsappNumber: null, email: "  a@x.com " };
    expect(destinationForChannel("SMS", c)).toBe("+923001234567");
    expect(destinationForChannel("WHATSAPP", c)).toBeNull();
    expect(destinationForChannel("EMAIL", c)).toBe("a@x.com");
    expect(destinationForChannel("EMAIL", { ...c, email: null })).toBeNull();
    expect(destinationForChannel("EMAIL", { ...c, email: "   " })).toBeNull();
  });
});

describe("phone sign-in switch", () => {
  it("needs both the phone switch and the applicant sign-in code switch", async () => {
    expect(await phoneLoginEnabled()).toBe(false);
    flags["auth.phone_login.enabled"] = true;
    expect(await phoneLoginEnabled()).toBe(false);
    flags["auth.applicant_otp_login.enabled"] = true;
    expect(await phoneLoginEnabled()).toBe(true);
  });
});

describe("channelIsReal", () => {
  it("is false for the sandbox, for an unconfigured provider and for WhatsApp without an OTP template", async () => {
    chain.mockResolvedValue([sandbox]);
    expect(await channelIsReal("SMS", "+923001234567", {})).toBe(false);
    chain.mockResolvedValue([{ adapter: { external: true, isConfigured: () => false }, sandboxed: false }]);
    expect(await channelIsReal("SMS", "+923001234567", {})).toBe(false);
    chain.mockResolvedValue([real]);
    expect(await channelIsReal("WHATSAPP", "+923001234567", {})).toBe(false);
    expect(await channelIsReal("WHATSAPP", "+923001234567", { WHATSAPP_OTP_TEMPLATE_NAME: "login_code" })).toBe(true);
    chain.mockResolvedValue([]);
    expect(await channelIsReal("SMS", "+923001234567", {})).toBe(false);
  });
});

describe("sendContactCode", () => {
  it("with the switch OFF sends to the e-mail address only and never asks about phone providers", async () => {
    const r = await sendContactCode("p1", "LOGIN");
    expect(r.channel).toBe("EMAIL");
    expect(sendOtpMock).toHaveBeenCalledWith("p1", "EMAIL", "a@x.com", "LOGIN", {});
    expect(chain).not.toHaveBeenCalled();
  });

  it("with the switch OFF and no e-mail on the profile, says no channel can deliver", async () => {
    contactRow.current = { mobileNumber: "0300 1234567", whatsappNumber: null, email: null };
    await expect(sendContactCode("p1", "LOGIN")).rejects.toBeInstanceOf(NoCodeChannelError);
    expect(sendOtpMock).not.toHaveBeenCalled();
  });

  describe("with the switch ON", () => {
    beforeEach(() => {
      flags["auth.phone_login.enabled"] = true;
      flags["auth.applicant_otp_login.enabled"] = true;
      process.env.WHATSAPP_OTP_TEMPLATE_NAME = "login_code";
    });

    it("uses WhatsApp first when a real WhatsApp provider is there", async () => {
      chain.mockResolvedValue([real]);
      const r = await sendContactCode("p1", "LOGIN");
      expect(r.channel).toBe("WHATSAPP");
      expect(sendOtpMock).toHaveBeenCalledTimes(1);
      expect(sendOtpMock).toHaveBeenCalledWith("p1", "PHONE", "+923017654321", "LOGIN", { deliverVia: "WHATSAPP" });
    });

    it("falls to SMS when WhatsApp is only a sandbox", async () => {
      chain.mockImplementation(async ({ channel }: { channel: string }) => (channel === "SMS" ? [real] : [sandbox]));
      const r = await sendContactCode("p1", "REAUTH");
      expect(r.channel).toBe("SMS");
      expect(sendOtpMock).toHaveBeenCalledWith("p1", "PHONE", "+923001234567", "VERIFY", { deliverVia: "SMS" });
    });

    it("falls through a channel that fails to the next one, ending at e-mail", async () => {
      chain.mockResolvedValue([real]);
      sendOtpMock.mockImplementation(async (_p: string, channel: string) => {
        if (channel === "PHONE") throw new Error("provider down");
        return { destinationMasked: "a***@x.com" };
      });
      const r = await sendContactCode("p1", "LOGIN");
      expect(r.channel).toBe("EMAIL");
      expect(sendOtpMock).toHaveBeenCalledTimes(3);
    });

    it("skips WhatsApp when the profile has no WhatsApp number", async () => {
      contactRow.current = { mobileNumber: "0300 1234567", whatsappNumber: null, email: null };
      chain.mockResolvedValue([real]);
      const r = await sendContactCode("p1", "LOGIN");
      expect(r.channel).toBe("SMS");
    });

    it("reports honestly when nothing can deliver (never pretends a sandbox sent it)", async () => {
      contactRow.current = { mobileNumber: "0300 1234567", whatsappNumber: null, email: null };
      chain.mockResolvedValue([sandbox]);
      await expect(sendContactCode("p1", "LOGIN")).rejects.toBeInstanceOf(NoCodeChannelError);
      expect(sendOtpMock).not.toHaveBeenCalled();
    });

    it("throws when the profile has no contact record", async () => {
      contactRow.current = null;
      await expect(sendContactCode("p1", "LOGIN")).rejects.toBeInstanceOf(NoCodeChannelError);
    });
  });
});

describe("e-mail is optional", () => {
  it("counts as met when verified, or when there is no address to verify", () => {
    expect(emailRequirementMet(new Date(), "a@x.com")).toBe(true);
    expect(emailRequirementMet(null, null)).toBe(true);
    expect(emailRequirementMet(null, "  ")).toBe(true);
    expect(emailRequirementMet(null, "a@x.com")).toBe(false);
  });
});
