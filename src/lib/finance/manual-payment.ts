import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { isValidPaymentStatusTransition, isValidOrderStatusTransition } from "@/lib/finance/status-transitions";
import { generateInvoice } from "@/lib/finance/invoice";
import { activateSubscription, confirmRenewal } from "@/lib/finance/subscription";
import { notifyPaymentSuccess, notifyPaymentFailed } from "@/lib/notifications/events";

// Spec §44 — Pending Verification -> Verified -> Subscription Activated, or
// Pending Verification -> Rejected (reason required). Never activates a
// subscription until this explicit admin action confirms the transfer.
// Either the applicant self-submits (submittedByProfileId) or an admin
// records it on the customer's behalf (enteredById) — never both.
export async function recordManualPayment(params: { paymentId: string; referenceNumber: string; evidenceDescription?: string; enteredById?: string; submittedByProfileId?: string }) {
  const detail = await prisma.manualPaymentDetail.create({
    data: {
      paymentId: params.paymentId,
      referenceNumber: params.referenceNumber,
      evidenceDescription: params.evidenceDescription ?? null,
      enteredById: params.enteredById ?? null,
      submittedByProfileId: params.submittedByProfileId ?? null,
    },
  });
  await writeAudit({
    action: "MANUAL_PAYMENT_RECORDED",
    adminId: params.enteredById ?? null,
    targetProfileId: params.submittedByProfileId ?? null,
    meta: { paymentId: params.paymentId, referenceNumber: params.referenceNumber },
  });
  return detail;
}

export async function verifyManualPayment(paymentId: string, verifiedById: string) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: { order: { include: { items: true } }, manualDetail: true } });
  if (!payment || !payment.manualDetail) throw new Error("Manual payment not found");
  if (payment.manualDetail.status !== "PENDING_VERIFICATION") throw new Error("This payment has already been verified or rejected.");
  if (!isValidPaymentStatusTransition(payment.status, "PAID")) throw new Error(`Cannot mark payment as PAID from status ${payment.status}`);
  if (!isValidOrderStatusTransition(payment.order.status, "PAID")) throw new Error(`Cannot mark order as PAID from status ${payment.order.status}`);

  await prisma.$transaction([
    prisma.manualPaymentDetail.update({ where: { paymentId }, data: { status: "VERIFIED", verifiedById, verifiedAt: new Date() } }),
    prisma.payment.update({ where: { id: paymentId }, data: { status: "PAID", paidAt: new Date() } }),
    prisma.order.update({ where: { id: payment.orderId }, data: { status: "PAID", completedAt: new Date() } }),
  ]);

  await writeAudit({ action: "MANUAL_PAYMENT_VERIFIED", adminId: verifiedById, targetProfileId: payment.profileId, meta: { paymentId } });
  await notifyPaymentSuccess(payment.profileId);

  const invoice = await generateInvoice(payment.orderId);

  const orderItem = payment.order.items[0];
  if (payment.order.subscriptionId) {
    await confirmRenewal(payment.order.subscriptionId, 30);
  } else if (orderItem) {
    const pkg = await prisma.package.findUnique({ where: { id: orderItem.packageId } });
    if (pkg) {
      await activateSubscription({ profileId: payment.profileId, packageId: pkg.id, billingType: pkg.billingType, durationDays: pkg.durationDays, trialDays: pkg.trialDays });
    }
  }

  return { payment, invoice };
}

export async function rejectManualPayment(paymentId: string, rejectedById: string, rejectionReason: string) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: { manualDetail: true } });
  if (!payment || !payment.manualDetail) throw new Error("Manual payment not found");
  if (payment.manualDetail.status !== "PENDING_VERIFICATION") throw new Error("This payment has already been verified or rejected.");
  if (!rejectionReason?.trim()) throw new Error("A rejection reason is required.");

  await prisma.$transaction([
    prisma.manualPaymentDetail.update({ where: { paymentId }, data: { status: "REJECTED", verifiedById: rejectedById, verifiedAt: new Date(), rejectionReason } }),
    prisma.payment.update({ where: { id: paymentId }, data: { status: "FAILED", failedAt: new Date() } }),
  ]);

  await writeAudit({ action: "MANUAL_PAYMENT_REJECTED", adminId: rejectedById, targetProfileId: payment.profileId, meta: { paymentId, rejectionReason } });
  await notifyPaymentFailed(payment.profileId);
}
