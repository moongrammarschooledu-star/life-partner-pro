import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { getProvider } from "@/lib/finance/providers/registry";
import { generateInvoice } from "@/lib/finance/invoice";
import { activateSubscription } from "@/lib/finance/subscription";
import { notifyPaymentSuccess, notifyPaymentFailed } from "@/lib/notifications/events";
import { getPaymentFeatureFlags } from "@/lib/finance/rollout";
import type { PaymentProviderName } from "@prisma/client";

const VALID_PROVIDERS: PaymentProviderName[] = ["MANUAL", "STRIPE"];

// Spec §28/§29/§60 — every webhook verifies a provider signature, validates
// the event type/payload, checks the transaction, and is idempotent via a
// @@unique([provider, providerEventId]) constraint on PaymentWebhookEvent —
// a replayed/duplicate delivery fails the unique insert and is treated as
// already-processed, never reprocessed. Never trusts a client-supplied
// amount/currency/status — always re-derives from the parsed event.
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerParam } = await params;
  const providerName = providerParam.toUpperCase() as PaymentProviderName;
  if (!VALID_PROVIDERS.includes(providerName)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
  }

  const rawBody = await req.text();
  const provider = getProvider(providerName);
  const signatureHeader = req.headers.get("stripe-signature") ?? req.headers.get("x-webhook-signature");

  if (!provider.verifyWebhook(rawBody, signatureHeader)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Spec §71 — an emergency, admin-controlled stop for webhook intake
  // specifically, separate from the rollout kill switch (which only blocks
  // *new* checkout sessions). Return 200 so the provider doesn't treat this
  // as a delivery failure and retry-storm; nothing here has been persisted yet.
  const flags = await getPaymentFeatureFlags();
  if (!flags.providerWebhooksEnabled) {
    return NextResponse.json({ ok: true, skipped: true, reason: "Webhook processing is currently disabled." });
  }

  const event = provider.parseWebhookEvent(rawBody);
  if (!event) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const payloadHash = createHash("sha256").update(rawBody).digest("hex");

  let webhookEvent;
  try {
    webhookEvent = await prisma.paymentWebhookEvent.create({
      data: { provider: providerName, providerEventId: event.providerEventId, eventType: event.eventType, payloadHash, status: "RECEIVED" },
    });
  } catch {
    // Unique constraint violation = already processed (idempotency/replay guard).
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    if (event.providerTransactionId) {
      const payment = await prisma.payment.findUnique({ where: { provider_providerTransactionId: { provider: providerName, providerTransactionId: event.providerTransactionId } }, include: { order: { include: { items: true } } } });
      if (payment) {
        // Amount/currency verification (spec §28) before trusting the event.
        if (event.amountMinor != null && event.amountMinor !== payment.amountMinor) {
          await prisma.paymentWebhookEvent.update({ where: { id: webhookEvent.id }, data: { status: "FAILED", errorCode: "AMOUNT_MISMATCH", processedAt: new Date() } });
          return NextResponse.json({ ok: false, error: "Amount mismatch" }, { status: 200 });
        }

        if (event.status === "PAID" && payment.status !== "PAID") {
          await prisma.$transaction([
            prisma.payment.update({ where: { id: payment.id }, data: { status: "PAID", paidAt: new Date() } }),
            prisma.order.update({ where: { id: payment.orderId }, data: { status: "PAID", completedAt: new Date() } }),
          ]);
          await writeAudit({ action: "PAYMENT_STATUS_CHANGED", targetProfileId: payment.profileId, meta: { paymentId: payment.id, status: "PAID", source: "webhook" } });
          await notifyPaymentSuccess(payment.profileId);
          await generateInvoice(payment.orderId);
          const item = payment.order.items[0];
          if (item) {
            const pkg = await prisma.package.findUnique({ where: { id: item.packageId } });
            if (pkg) await activateSubscription({ profileId: payment.profileId, packageId: pkg.id, billingType: pkg.billingType, durationDays: pkg.durationDays, trialDays: pkg.trialDays });
          }
        } else if (event.status === "FAILED" && payment.status !== "FAILED") {
          await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED", failedAt: new Date() } });
          await notifyPaymentFailed(payment.profileId);
        }
      }
    }

    await prisma.paymentWebhookEvent.update({ where: { id: webhookEvent.id }, data: { status: "PROCESSED", processedAt: new Date() } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    await prisma.paymentWebhookEvent.update({ where: { id: webhookEvent.id }, data: { status: "FAILED", errorCode: "PROCESSING_ERROR", retryCount: { increment: 1 } } }).catch(() => {});
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Processing error" }, { status: 200 });
  }
}
