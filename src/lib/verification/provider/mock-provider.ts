import { randomUUID, createHmac, timingSafeEqual } from "crypto";
import type { IdentityVerificationProvider, VerificationSession, VerificationResult, VerificationEventParsed, VerificationResultStatus } from "./types";

// The only provider shipped in this pass (spec §5/§60 — safe defaults,
// IDENTITY_VERIFICATION_ENABLED=false). It fully implements the real
// webhook-security contract (HMAC signature + JSON event parsing) rather
// than short-circuiting it like ManualPaymentProvider's `verifyWebhook()
// always false` — the point of a mock provider here is to let the whole
// provider-session → webhook → review pipeline be exercised and tested
// end-to-end without a live third-party account.
const VALID_STATUSES: VerificationResultStatus[] = ["PENDING", "IN_PROGRESS", "APPROVED", "REJECTED", "REQUIRES_INPUT", "EXPIRED", "CANCELLED"];

function outcomeFromEnv(): VerificationResultStatus {
  const configured = process.env.IDENTITY_VERIFICATION_MOCK_OUTCOME;
  return configured && (VALID_STATUSES as string[]).includes(configured) ? (configured as VerificationResultStatus) : "APPROVED";
}

export const MockVerificationProvider: IdentityVerificationProvider = {
  name: "mock",

  async createSession({ documentType, country }): Promise<VerificationSession> {
    const sessionId = randomUUID();
    return {
      sessionId,
      providerReference: `MOCK-${sessionId.slice(0, 8).toUpperCase()}`,
      redirectUrl: null,
      instructions: `Sandbox identity verification (${documentType}, ${country}). No real document is transmitted to any third party — this provider is for local/staging testing only.`,
    };
  },

  async startVerification({ sessionId }): Promise<VerificationResult> {
    return { status: "IN_PROGRESS", providerReference: `MOCK-${sessionId.slice(0, 8).toUpperCase()}`, reasonCode: null };
  },

  async getVerification(id): Promise<VerificationResult> {
    const status = outcomeFromEnv();
    return { status, providerReference: `MOCK-${id.slice(0, 8).toUpperCase()}`, reasonCode: status === "REJECTED" ? "MOCK_CONFIGURED_REJECTION" : null };
  },

  // Fails closed: with no secret configured, every webhook is rejected
  // rather than accepted-by-default — matching the spec's own "never trust
  // a frontend/webhook claim without verification" requirement even for the
  // mock provider.
  verifyWebhook(rawBody, signatureHeader): boolean {
    const secret = process.env.IDENTITY_VERIFICATION_WEBHOOK_SECRET;
    if (!secret || !signatureHeader) return false;
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    const expectedBuf = Buffer.from(expected, "hex");
    const givenBuf = Buffer.from(signatureHeader, "hex");
    if (expectedBuf.length !== givenBuf.length) return false;
    return timingSafeEqual(expectedBuf, givenBuf);
  },

  parseWebhookEvent(rawBody): VerificationEventParsed | null {
    try {
      const parsed = JSON.parse(rawBody) as Record<string, unknown>;
      if (typeof parsed.eventId !== "string" || typeof parsed.type !== "string") return null;
      const status = typeof parsed.status === "string" && (VALID_STATUSES as string[]).includes(parsed.status) ? (parsed.status as VerificationResultStatus) : null;
      return {
        providerEventId: parsed.eventId,
        eventType: parsed.type,
        sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : null,
        status,
      };
    } catch {
      return null;
    }
  },

  async cancelVerification(): Promise<void> {
    // No-op — no persistent session state on the provider side to cancel.
  },
};
