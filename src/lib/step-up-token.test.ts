import { describe, it, expect, beforeAll } from "vitest";
import { issueStepUpToken, verifyStepUpToken } from "./step-up-token";

describe("step-up-token", () => {
  beforeAll(() => {
    process.env.NEXTAUTH_SECRET = "test-secret-for-step-up-token";
  });

  it("verifies a freshly issued token for the same purpose and subject", () => {
    const token = issueStepUpToken("LOGIN_2FA", "admin@example.com", 60_000);
    expect(verifyStepUpToken(token, "LOGIN_2FA", "admin@example.com")).toBe(true);
  });

  it("rejects a token for a different purpose", () => {
    const token = issueStepUpToken("LOGIN_2FA", "admin@example.com", 60_000);
    expect(verifyStepUpToken(token, "REAUTH", "admin@example.com")).toBe(false);
  });

  it("rejects a token for a different subject", () => {
    const token = issueStepUpToken("LOGIN_2FA", "admin@example.com", 60_000);
    expect(verifyStepUpToken(token, "LOGIN_2FA", "someone-else@example.com")).toBe(false);
  });

  it("rejects an expired token", () => {
    const token = issueStepUpToken("LOGIN_2FA", "admin@example.com", -1);
    expect(verifyStepUpToken(token, "LOGIN_2FA", "admin@example.com")).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const token = issueStepUpToken("LOGIN_2FA", "admin@example.com", 60_000);
    const [payload] = token.split(".");
    const tampered = `${payload}.deadbeef`;
    expect(verifyStepUpToken(tampered, "LOGIN_2FA", "admin@example.com")).toBe(false);
  });

  it("rejects a tampered payload", () => {
    const token = issueStepUpToken("LOGIN_2FA", "admin@example.com", 60_000);
    const [, signature] = token.split(".");
    const forgedPayload = Buffer.from("LOGIN_2FA:attacker@example.com:99999999999999").toString("base64url");
    expect(verifyStepUpToken(`${forgedPayload}.${signature}`, "LOGIN_2FA", "attacker@example.com")).toBe(false);
  });

  it("rejects missing or malformed tokens", () => {
    expect(verifyStepUpToken(null, "LOGIN_2FA", "admin@example.com")).toBe(false);
    expect(verifyStepUpToken(undefined, "LOGIN_2FA", "admin@example.com")).toBe(false);
    expect(verifyStepUpToken("not-a-real-token", "LOGIN_2FA", "admin@example.com")).toBe(false);
  });
});
