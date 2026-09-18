// Spec §2 — a provider abstraction so the application is never locked to
// one payment gateway. Every method is async since a real gateway involves
// network calls; ManualPaymentProvider fulfills the same shape purely with
// local state.

export interface CheckoutSession {
  paymentId: string;
  providerReference: string | null; // e.g. a Stripe checkout session id, or a manual bank-transfer reference
  redirectUrl: string | null; // null for Manual — the UI shows instructions instead
  instructions: string | null; // e.g. bank account details for Manual
}

export interface ProviderPaymentResult {
  status: "PENDING" | "PAID" | "FAILED";
  providerTransactionId: string | null;
}

export interface ProviderRefundResult {
  status: "PROCESSING" | "COMPLETED" | "FAILED";
  providerRefundId: string | null;
}

export interface WebhookEventParsed {
  providerEventId: string;
  eventType: string;
  providerTransactionId: string | null;
  amountMinor: number | null;
  currencyCode: string | null;
  status: "PAID" | "FAILED" | "REFUNDED" | "UNKNOWN";
}

export interface PaymentProvider {
  name: "MANUAL" | "STRIPE";
  createCheckout(params: { paymentId: string; amountMinor: number; currencyCode: string; description: string }): Promise<CheckoutSession>;
  verifyPayment(providerTransactionId: string): Promise<ProviderPaymentResult>;
  getPayment(providerTransactionId: string): Promise<ProviderPaymentResult>;
  refundPayment(params: { providerTransactionId: string; amountMinor: number }): Promise<ProviderRefundResult>;
  cancelPayment(providerTransactionId: string): Promise<void>;
  createSubscription(params: { profileId: string; amountMinor: number; currencyCode: string; intervalDays: number }): Promise<{ providerSubscriptionId: string | null }>;
  cancelSubscription(providerSubscriptionId: string): Promise<void>;
  verifyWebhook(rawBody: string, signatureHeader: string | null): boolean;
  parseWebhookEvent(rawBody: string): WebhookEventParsed | null;
}

export class ProviderNotConfiguredError extends Error {
  constructor(provider: string) {
    super(`Payment provider "${provider}" is not configured — missing required credentials.`);
    this.name = "ProviderNotConfiguredError";
  }
}
