import { describe, it, expect, beforeAll } from "vitest";
import { signProfileToken, verifyProfileToken, signSessionId, verifySessionIdToken } from "./applicant-session";

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-for-applicant-session";
});

describe("signProfileToken / verifyProfileToken", () => {
  it("round-trips a profile id", () => {
    const token = signProfileToken("profile-123");
    expect(verifyProfileToken(token)).toBe("profile-123");
  });

  it("rejects a tampered token", () => {
    const token = signProfileToken("profile-123");
    const tampered = token.replace("profile-123", "profile-456");
    expect(verifyProfileToken(tampered)).toBeNull();
  });

  it("rejects a missing token", () => {
    expect(verifyProfileToken(null)).toBeNull();
    expect(verifyProfileToken(undefined)).toBeNull();
  });

  it("rejects a malformed token with no signature separator", () => {
    expect(verifyProfileToken("not-a-real-token")).toBeNull();
  });
});

describe("signSessionId / verifySessionIdToken (STEP 13)", () => {
  it("round-trips a session id", () => {
    const token = signSessionId("session-abc");
    expect(verifySessionIdToken(token)).toBe("session-abc");
  });

  it("rejects a tampered session token", () => {
    const token = signSessionId("session-abc");
    const tampered = token.replace("session-abc", "session-xyz");
    expect(verifySessionIdToken(tampered)).toBeNull();
  });

  it("rejects a missing token", () => {
    expect(verifySessionIdToken(null)).toBeNull();
  });
});
