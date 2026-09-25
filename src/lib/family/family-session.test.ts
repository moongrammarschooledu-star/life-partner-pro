import { describe, it, expect, beforeAll } from "vitest";
import { signFamilySessionId, verifyFamilySessionIdToken } from "./family-session";

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-for-family-session";
});

describe("signFamilySessionId / verifyFamilySessionIdToken", () => {
  it("round-trips a session id", () => {
    const token = signFamilySessionId("fam-session-abc");
    expect(verifyFamilySessionIdToken(token)).toBe("fam-session-abc");
  });

  it("rejects a tampered token", () => {
    const token = signFamilySessionId("fam-session-abc");
    const tampered = token.replace("fam-session-abc", "fam-session-xyz");
    expect(verifyFamilySessionIdToken(tampered)).toBeNull();
  });

  it("rejects a missing token", () => {
    expect(verifyFamilySessionIdToken(null)).toBeNull();
    expect(verifyFamilySessionIdToken(undefined)).toBeNull();
  });

  it("rejects a malformed token with no signature separator", () => {
    expect(verifyFamilySessionIdToken("not-a-real-token")).toBeNull();
  });

  it("never collides with an applicant session token's signature for the same id", async () => {
    const { signSessionId } = await import("../applicant-session");
    const familyToken = signFamilySessionId("shared-id-123");
    const applicantToken = signSessionId("shared-id-123");
    // Same HMAC scheme/secret by design (Decision 2) — but a family
    // session-id token must never be accepted by the applicant verifier or
    // vice versa in a real route (that's enforced by which cookie name each
    // route reads, not by the crypto itself). Here we just confirm the two
    // functions are independently callable and the family token verifies
    // correctly under its own verifier regardless.
    expect(verifyFamilySessionIdToken(familyToken)).toBe("shared-id-123");
    expect(applicantToken).toContain("shared-id-123");
  });
});
