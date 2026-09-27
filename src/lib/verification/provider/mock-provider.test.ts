import { describe, it, expect, afterEach } from "vitest";
import { createHmac } from "crypto";
import { MockVerificationProvider } from "./mock-provider";

const SECRET = "test-webhook-secret";

describe("MockVerificationProvider", () => {
  afterEach(() => {
    delete process.env.IDENTITY_VERIFICATION_WEBHOOK_SECRET;
    delete process.env.IDENTITY_VERIFICATION_MOCK_OUTCOME;
  });

  it("creates a session with a provider reference and no redirect URL", async () => {
    const session = await MockVerificationProvider.createSession({ profileId: "p1", documentType: "CNIC", country: "Pakistan" });
    expect(session.sessionId).toBeTruthy();
    expect(session.providerReference).toMatch(/^MOCK-/);
    expect(session.redirectUrl).toBeNull();
  });

  it("getVerification defaults to APPROVED with no configured outcome", async () => {
    const result = await MockVerificationProvider.getVerification("abc123");
    expect(result.status).toBe("APPROVED");
    expect(result.reasonCode).toBeNull();
  });

  it("getVerification honors a configured mock outcome", async () => {
    process.env.IDENTITY_VERIFICATION_MOCK_OUTCOME = "REJECTED";
    const result = await MockVerificationProvider.getVerification("abc123");
    expect(result.status).toBe("REJECTED");
    expect(result.reasonCode).toBe("MOCK_CONFIGURED_REJECTION");
  });

  describe("verifyWebhook", () => {
    it("fails closed when no secret is configured", () => {
      const ok = MockVerificationProvider.verifyWebhook("{}", "deadbeef");
      expect(ok).toBe(false);
    });

    it("fails closed when no signature header is given, even with a secret configured", () => {
      process.env.IDENTITY_VERIFICATION_WEBHOOK_SECRET = SECRET;
      const ok = MockVerificationProvider.verifyWebhook("{}", null);
      expect(ok).toBe(false);
    });

    it("accepts a correctly signed payload", () => {
      process.env.IDENTITY_VERIFICATION_WEBHOOK_SECRET = SECRET;
      const body = JSON.stringify({ eventId: "evt1", type: "verification.updated" });
      const signature = createHmac("sha256", SECRET).update(body).digest("hex");
      expect(MockVerificationProvider.verifyWebhook(body, signature)).toBe(true);
    });

    it("rejects a payload signed with the wrong secret", () => {
      process.env.IDENTITY_VERIFICATION_WEBHOOK_SECRET = SECRET;
      const body = JSON.stringify({ eventId: "evt1", type: "verification.updated" });
      const signature = createHmac("sha256", "wrong-secret").update(body).digest("hex");
      expect(MockVerificationProvider.verifyWebhook(body, signature)).toBe(false);
    });

    it("rejects a tampered payload signed for different content", () => {
      process.env.IDENTITY_VERIFICATION_WEBHOOK_SECRET = SECRET;
      const original = JSON.stringify({ eventId: "evt1", type: "verification.updated" });
      const signature = createHmac("sha256", SECRET).update(original).digest("hex");
      const tampered = JSON.stringify({ eventId: "evt1", type: "verification.updated", status: "APPROVED" });
      expect(MockVerificationProvider.verifyWebhook(tampered, signature)).toBe(false);
    });
  });

  describe("parseWebhookEvent", () => {
    it("parses a well-formed event", () => {
      const event = MockVerificationProvider.parseWebhookEvent(
        JSON.stringify({ eventId: "evt1", type: "verification.updated", sessionId: "sess1", status: "APPROVED" })
      );
      expect(event).toEqual({ providerEventId: "evt1", eventType: "verification.updated", sessionId: "sess1", status: "APPROVED" });
    });

    it("returns null for malformed JSON", () => {
      expect(MockVerificationProvider.parseWebhookEvent("not json")).toBeNull();
    });

    it("returns null when required fields are missing", () => {
      expect(MockVerificationProvider.parseWebhookEvent(JSON.stringify({ type: "x" }))).toBeNull();
    });

    it("nulls an unrecognized status rather than passing it through", () => {
      const event = MockVerificationProvider.parseWebhookEvent(JSON.stringify({ eventId: "evt1", type: "x", status: "TOTALLY_MADE_UP" }));
      expect(event?.status).toBeNull();
    });
  });
});
