import { describe, it, expect } from "vitest";
import { verifyWebhookSignature, signWebhookPayload } from "@/lib/notifications/webhook-verify";

describe("verifyWebhookSignature", () => {
  const secret = "test-webhook-secret";
  const body = JSON.stringify({ event: "DELIVERED", providerMessageId: "abc123" });

  it("accepts a correctly signed payload", () => {
    const sig = signWebhookPayload(body, secret);
    expect(verifyWebhookSignature(body, sig, secret)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const sig = signWebhookPayload(body, secret);
    const tampered = JSON.stringify({ event: "DELIVERED", providerMessageId: "hacked" });
    expect(verifyWebhookSignature(tampered, sig, secret)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    const sig = signWebhookPayload(body, secret);
    expect(verifyWebhookSignature(body, sig, "wrong-secret")).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifyWebhookSignature(body, null, secret)).toBe(false);
    expect(verifyWebhookSignature(body, undefined, secret)).toBe(false);
  });

  it("rejects when no secret is configured", () => {
    const sig = signWebhookPayload(body, secret);
    expect(verifyWebhookSignature(body, sig, "")).toBe(false);
  });
});
