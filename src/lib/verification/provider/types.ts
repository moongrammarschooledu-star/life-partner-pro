// STEP 23 §8 — a provider abstraction so identity verification is never
// locked to one vendor, mirroring src/lib/finance/providers/types.ts's exact
// shape (PaymentProvider). Every method is async since a real provider
// involves network calls; MockVerificationProvider fulfills the same shape
// purely with local/deterministic state.

export type VerificationResultStatus = "PENDING" | "IN_PROGRESS" | "APPROVED" | "REJECTED" | "REQUIRES_INPUT" | "EXPIRED" | "CANCELLED";

export interface VerificationSession {
  sessionId: string;
  providerReference: string | null;
  redirectUrl: string | null; // null for a fully server-side flow — the UI shows instructions instead
  instructions: string | null;
}

export interface VerificationResult {
  status: VerificationResultStatus;
  providerReference: string | null;
  reasonCode: string | null;
}

export interface VerificationEventParsed {
  providerEventId: string;
  eventType: string;
  sessionId: string | null;
  status: VerificationResultStatus | null;
}

export interface IdentityVerificationProvider {
  name: string;
  createSession(input: { profileId: string; documentType: string; country: string }): Promise<VerificationSession>;
  startVerification(input: { sessionId: string }): Promise<VerificationResult>;
  getVerification(id: string): Promise<VerificationResult>;
  verifyWebhook(rawBody: string, signatureHeader: string | null): boolean;
  parseWebhookEvent(rawBody: string): VerificationEventParsed | null;
  cancelVerification(id: string): Promise<void>;
}

export class VerificationProviderNotConfiguredError extends Error {
  constructor(provider: string) {
    super(`Identity verification provider "${provider}" is not configured.`);
    this.name = "VerificationProviderNotConfiguredError";
  }
}
