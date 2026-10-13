import type { PushContent } from "@/lib/mobile/push/payload";

// The provider abstraction (STEP 37 §10). A provider only knows how to talk to ONE push service: it never decides who gets a message, what it says, or
// whether a person has consented. That is done by push-service.ts before a provider is ever called.

export type PushProviderId = "FCM" | "APNS";

export type PushOutcome =
  | { status: "SENT"; providerMessageId?: string }
  | { status: "INVALID_TOKEN"; reason: string } // the device no longer exists or the token is wrong: stop using it
  | { status: "FAILED"; reason: string; retryable: boolean };

export interface PushProvider {
  readonly id: PushProviderId;
  /** True when every setting the provider needs is present. Names are checked, never shown. */
  isConfigured(): boolean;
  /** A cheap format check, so an obviously wrong token is refused at registration. */
  validateToken(token: string): boolean;
  send(token: string, content: PushContent): Promise<PushOutcome>;
  sendBatch(tokens: string[], content: PushContent): Promise<PushOutcome[]>;
}

export const PUSH_TIMEOUT_MS = 8000;