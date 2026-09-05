import { describe, it, expect } from "vitest";
import { generateOtpCode, generateEmailToken, maskPhone, maskEmail, isExpired, expiresInMinutes } from "./otp";

describe("generateOtpCode", () => {
  it("always produces a 6-digit numeric string", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateOtpCode();
      expect(code).toMatch(/^\d{6}$/);
    }
  });
});

describe("generateEmailToken", () => {
  it("produces a long, url-safe token", () => {
    const token = generateEmailToken();
    expect(token.length).toBeGreaterThan(20);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("produces different tokens on each call", () => {
    expect(generateEmailToken()).not.toBe(generateEmailToken());
  });
});

describe("maskPhone", () => {
  it("keeps only the last 4 digits visible", () => {
    expect(maskPhone("+923001234567")).toBe("+********4567");
  });
});

describe("maskEmail", () => {
  it("keeps only the first local-part character visible", () => {
    expect(maskEmail("john.doe@example.com")).toBe("j*******@example.com");
  });
});

describe("isExpired / expiresInMinutes", () => {
  it("is not expired before the expiry time", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const expiry = expiresInMinutes(10, now);
    expect(isExpired(expiry, new Date(now.getTime() + 5 * 60_000))).toBe(false);
  });

  it("is expired at or after the expiry time", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const expiry = expiresInMinutes(10, now);
    expect(isExpired(expiry, new Date(now.getTime() + 10 * 60_000))).toBe(true);
    expect(isExpired(expiry, new Date(now.getTime() + 11 * 60_000))).toBe(true);
  });
});
