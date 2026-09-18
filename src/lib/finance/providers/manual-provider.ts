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
    const [settings, bankAccounts] = await Promise.all([
      prisma.appSettings.findUnique({ where: { id: 1 } }),
      prisma.bankAccount.findMany({ where: { active: true }, orderBy: { displayOrder: "asc" } }),
    ]);
    const reference = `LPP-${paymentId.slice(-8).toUpperCase()}`;

    const accountsBlock =
      bankAccounts.length > 0
        ? bankAccounts
            .map(
              (a) =>
                `— ${a.bankName}\n` +
                `  Account Title: ${a.accountTitle}\n` +
                `  Account Number: ${a.accountNumber}\n` +
                (a.iban ? `  IBAN: ${a.iban}\n` : "") +
                (a.branchName ? `  Branch: ${a.branchName}\n` : "")
            )
            .join("\n")
        : // No bank account configured yet — spec §43 requires a real
          // destination; this is a genuine gap the admin must fill in via
          // Finance Center → Bank Accounts before Manual payments can work.
          "No receiving bank account has been configured yet. Please contact us for payment instructions.";

    return {
      paymentId,
      providerReference: reference,
      redirectUrl: null,
      instructions:
        `Bank Transfer Instructions\n\n` +
        `Amount: ${(amountMinor / 100).toFixed(2)} ${currencyCode}\n` +
        `Reference: ${reference}\n` +
        `Description: ${description}\n\n` +
        `Transfer to one of the following ${bankAccounts.length > 1 ? "accounts" : "account"}:\n\n${accountsBlock}\n\n` +
        `After transferring, please submit your payment reference below for verification by ${settings?.appName ?? "Life Partner Pro"}.`,
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
