import { describe, it, expect, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => undefined }) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/rate-limit", () => ({ clientKeyFromRequest: () => "k" }));
vi.mock("@/lib/applicant-session", () => ({ signProfileToken: () => "t", signSessionId: () => "s", APPLICANT_COOKIE: "a", APPLICANT_SESSION_ID_COOKIE: "b" }));
vi.mock("@/lib/profile-session", () => ({ createProfileSession: async () => ({}) }));
vi.mock("@/lib/security/event-bus", () => ({ publishSecurityEvent: async () => undefined }));
vi.mock("@/lib/ops/feature-flags", () => ({ isFeatureEnabled: async () => false }));
vi.mock("@/lib/profile-restrictions", () => ({ hasActiveRestriction: async () => false }));
vi.mock("@/lib/verification/contact-code", () => ({ phoneLoginEnabled: async () => false }));

const { identifierMatchesContact } = await import("./applicant-login");

// STEP 38 - the sign-in identifier is an e-mail address, or (switch ON) a mobile / WhatsApp number written in any common way.

const contact = { email: "Ayesha@Example.com", mobileNumber: "0300 1234567", whatsappNumber: "+92 301 7654321" };

describe("identifierMatchesContact", () => {
  it("matches the e-mail address regardless of case or spaces", () => {
    expect(identifierMatchesContact("  ayesha@example.com ", contact, false)).toBe(true);
    expect(identifierMatchesContact("other@example.com", contact, false)).toBe(false);
  });

  it("never matches an e-mail address when the profile has none", () => {
    expect(identifierMatchesContact("a@example.com", { ...contact, email: null }, true)).toBe(false);
  });

  it("accepts a phone number only when phone sign-in is allowed", () => {
    expect(identifierMatchesContact("03001234567", contact, false)).toBe(false);
    expect(identifierMatchesContact("03001234567", contact, true)).toBe(true);
  });

  it("matches the mobile or the WhatsApp number in local, international and spaced forms", () => {
    for (const typed of ["0300 1234567", "+923001234567", "00923001234567", "3001234567", "+92-300-1234567"]) expect(identifierMatchesContact(typed, contact, true), typed).toBe(true);
    for (const typed of ["03017654321", "+92 301 7654321"]) expect(identifierMatchesContact(typed, contact, true), typed).toBe(true);
  });

  it("rejects a different number, junk and an empty or over-long value", () => {
    for (const typed of ["03009999999", "abc", "", "   ", "1".repeat(300)]) expect(identifierMatchesContact(typed, contact, true), typed).toBe(false);
  });
});
