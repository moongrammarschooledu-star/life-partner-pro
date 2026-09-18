import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import type { PaymentProvider, CheckoutSession, ProviderPaymentResult, ProviderRefundResult, WebhookEventParsed } from "./types";

// Spec §2/§43/§44 — the only fully-functional provider today (confirmed
// scope with the user). "Checkout" is bank-transfer instructions + a
// reference number; "verification" is an admin manually confirming the
// transfer happened (see src/lib/finance/manual-payment.ts) rather than an
// automated gateway callback. There is no webhook source for manual
// payments — verifyWebhook() always returns false.
export const ManualPaymentProvider: PaymentProvider = {
  name: "MANUAL",

  async createCheckout({ paymentId, amountMinor, currencyCode, description }): Promise<CheckoutSession> {
    const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
    const reference = `LPP-${paymentId.slice(-8).toUpperCase()}`;
    return {
      paymentId,
      providerReference: reference,
      redirectUrl: null,
      instructions:
        `Bank Transfer Instructions\n\n` +
        `Amount: ${(amountMinor / 100).toFixed(2)} ${currencyCode}\n` +
        `Reference: ${reference}\n` +
        `Description: ${description}\n\n` +
        `Please transfer to the account details provided by ${settings?.appName ?? "Life Partner Pro"} and submit your payment reference for verification.`,
    };
  },

  async verifyPayment(): Promise<ProviderPaymentResult> {
    // Manual payments are never auto-verified — an admin action is the only
    // path to PAID (see verifyManualPayment()).
    return { status: "PENDING", providerTransactionId: null };
  },

  async getPayment(providerTransactionId): Promise<ProviderPaymentResult> {
    return { status: "PENDING", providerTransactionId };
  },

  async refundPayment(): Promise<ProviderRefundResult> {
    // A manual refund is just a record of money returned outside the app —
    // recorded as COMPLETED immediately once an admin executes it.
    return { status: "COMPLETED", providerRefundId: `MANUAL-${randomUUID()}` };
  },

  async cancelPayment(): Promise<void> {
    // No-op — local status is updated by the caller.
  },

  async createSubscription(): Promise<{ providerSubscriptionId: string | null }> {
    return { providerSubscriptionId: null }; // no recurring gateway to call
  },

  async cancelSubscription(): Promise<void> {
    // No-op
  },

  verifyWebhook(): boolean {
    return false; // no webhook source for manual payments
  },

  parseWebhookEvent(): WebhookEventParsed | null {
    return null;
  },
};
