import { createHmac, timingSafeEqual } from "crypto";
import type { PaymentProvider, CheckoutSession, ProviderPaymentResult, ProviderRefundResult, WebhookEventParsed } from "./types";
import { ProviderNotConfiguredError } from "./types";

// Spec §2 — implemented against the same PaymentProvider interface as
// ManualPaymentProvider, but no `stripe` npm dependency is installed and no
// real API call is ever made until real credentials exist (confirmed scope
// with the user) — mirrors this codebase's existing SMS/WhatsApp provider
// pattern of checking an env var first, except a payment provider refuses
// (throws) rather than silently no-ops, since silently "succeeding" a fake
// checkout would be unsafe. verifyWebhook() below is real HMAC-signature
// verification logic, ready to use the day STRIPE_WEBHOOK_SECRET is set.
function requireConfigured(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new ProviderNotConfiguredError("STRIPE");
  return key;
}

export const StripeProvider: PaymentProvider = {
  name: "STRIPE",

  async createCheckout(): Promise<CheckoutSession> {
    requireConfigured();
    throw new ProviderNotConfiguredError("STRIPE");
  },

  async verifyPayment(): Promise<ProviderPaymentResult> {
    requireConfigured();
    throw new ProviderNotConfiguredError("STRIPE");
  },

  async getPayment(): Promise<ProviderPaymentResult> {
    requireConfigured();
    throw new ProviderNotConfiguredError("STRIPE");
  },

  async refundPayment(): Promise<ProviderRefundResult> {
    requireConfigured();
    throw new ProviderNotConfiguredError("STRIPE");
  },

  async cancelPayment(): Promise<void> {
    requireConfigured();
    throw new ProviderNotConfiguredError("STRIPE");
  },

  async createSubscription(): Promise<{ providerSubscriptionId: string | null }> {
    requireConfigured();
    throw new ProviderNotConfiguredError("STRIPE");
  },

  async cancelSubscription(): Promise<void> {
    requireConfigured();
    throw new ProviderNotConfiguredError("STRIPE");
  },

  // Real, usable HMAC verification (Stripe's actual scheme: a timestamped,
  // comma-separated header signed over `${timestamp}.${rawBody}`) — the one
  // method here that's genuinely functional once STRIPE_WEBHOOK_SECRET is
  // configured, since verifying a signature needs no SDK/network call.
  verifyWebhook(rawBody: string, signatureHeader: string | null): boolean {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret || !signatureHeader) return false;

    const parts = Object.fromEntries(signatureHeader.split(",").map((kv) => kv.split("=") as [string, string]));
    const timestamp = parts.t;
    const signature = parts.v1;
    if (!timestamp || !signature) return false;

    const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  },

  parseWebhookEvent(rawBody: string): WebhookEventParsed | null {
    try {
      const event = JSON.parse(rawBody);
      return {
        providerEventId: event.id,
        eventType: event.type,
        providerTransactionId: event.data?.object?.id ?? null,
        amountMinor: event.data?.object?.amount ?? null,
        currencyCode: event.data?.object?.currency?.toUpperCase() ?? null,
        status: event.type?.includes("succeeded") ? "PAID" : event.type?.includes("failed") ? "FAILED" : event.type?.includes("refund") ? "REFUNDED" : "UNKNOWN",
      };
    } catch {
      return null;
    }
  },
};
