import { describe, it, expect, vi, afterEach } from "vitest";
import { isEmailConfigured, emailProvider } from "@/lib/notifications/providers/email-provider";

describe("isEmailConfigured", () => {
  it("needs both SMTP_USER and SMTP_PASS", () => {
    expect(isEmailConfigured({})).toBe(false);
    expect(isEmailConfigured({ SMTP_USER: "a@example.com" })).toBe(false);
    expect(isEmailConfigured({ SMTP_PASS: "x" })).toBe(false);
    expect(isEmailConfigured({ SMTP_USER: " ", SMTP_PASS: " " })).toBe(false);
    expect(isEmailConfigured({ SMTP_USER: "a@example.com", SMTP_PASS: "x" })).toBe(true);
  });

  it("does not treat the legacy placeholder key as configured", () => {
    expect(isEmailConfigured({ EMAIL_PROVIDER_API_KEY: "anything" })).toBe(false);
  });
});

describe("emailProvider without SMTP credentials", () => {
  afterEach(() => vi.restoreAllMocks());

  it("falls back to the console provider and never claims a real delivery", async () => {
    vi.stubEnv("SMTP_USER", "");
    vi.stubEnv("SMTP_PASS", "");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await emailProvider.send("to@example.com", "hello", "subject");
    expect(res.providerMessageId).toMatch(/^console-email-/);
    expect(log).toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
