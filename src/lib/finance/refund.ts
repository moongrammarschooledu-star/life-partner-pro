import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { isValidRefundStatusTransition, isValidPaymentStatusTransition } from "@/lib/finance/status-transitions";
import { getProvider } from "@/lib/finance/providers/registry";
import { notifyRefundRequested, notifyRefundCompleted } from "@/lib/notifications/events";
import type { RefundType, RefundStatus } from "@prisma/client";

// Spec §23 — RBAC tiers enforced by the caller (route checks the
// permission before calling); this module enforces the status machine and
// idempotency. finance:refunds:request (STAFF+), finance:refunds:approve
// (ADMIN+ — "Authorized Admin"), execution requires SUPER_ADMIN/
// finance:payments:manage + reauth (checked in the route).
export async function requestRefund(params: { paymentId: string; amountMinor: number; type: RefundType; reason: string; requestedById: string }) {
  const payment = await prisma.payment.findUnique({ where: { id: params.paymentId } });
  if (!payment) throw new Error("Payment not found");
  if (payment.status !== "PAID" && payment.status !== "PARTIALLY_REFUNDED") throw new Error("Only a paid payment can be refunded.");
  if (params.amountMinor > payment.amountMinor) throw new Error("Refund amount cannot exceed the original payment amount.");

  const refundCode = await nextSequenceCode("REF");
  const refund = await prisma.refund.create({
    data: {
      refundCode,
      paymentId: params.paymentId,
      amountMinor: params.amountMinor,
      currencyCode: payment.currencyCode,
      type: params.type,
      reason: params.reason,
      provider: payment.provider,
      requestedById: params.requestedById,
      status: "REQUESTED",
    },
  });
  await writeAudit({ action: "REFUND_REQUESTED", adminId: params.requestedById, targetProfileId: payment.profileId, meta: { refundId: refund.id, paymentId: params.paymentId, amountMinor: params.amountMinor } });
  await notifyRefundRequested(payment.profileId);
  return refund;
}

async function transitionRefund(refundId: string, toStatus: RefundStatus) {
  const refund = await prisma.refund.findUnique({ where: { id: refundId } });
  if (!refund) throw new Error("Refund not found");
  if (!isValidRefundStatusTransition(refund.status, toStatus)) {
    throw new Error(`Invalid refund status transition: ${refund.status} -> ${toStatus}`);
  }
  return refund;
}

export async function approveRefund(refundId: string, approvedById: string) {
  const refund = await transitionRefund(refundId, "APPROVED");
  await prisma.refund.update({ where: { id: refundId }, data: { status: "APPROVED", approvedById } });
  await writeAudit({ action: "REFUND_APPROVED", adminId: approvedById, meta: { refundId } });
  return refund;
}

export async function rejectRefund(refundId: string, rejectedById: string) {
  await transitionRefund(refundId, "REJECTED");
  await prisma.refund.update({ where: { id: refundId }, data: { status: "REJECTED" } });
  await writeAudit({ action: "REFUND_REJECTED", adminId: rejectedById, meta: { refundId } });
}

// Idempotent: a refund already PROCESSING/COMPLETED cannot be executed
// again (spec §24) — enforced by the status-transition guard, since
// PROCESSING/COMPLETED are not valid "from" states with an outgoing edge
// back into themselves.
export async function executeRefund(refundId: string, executedById: string) {
  const refund = await transitionRefund(refundId, "PROCESSING");
  await prisma.refund.update({ where: { id: refundId }, data: { status: "PROCESSING", executedById } });

  const payment = await prisma.payment.findUnique({ where: { id: refund.paymentId } });
  if (!payment) throw new Error("Payment not found");

  const provider = getProvider(refund.provider);
  const result = await provider.refundPayment({ providerTransactionId: payment.providerTransactionId ?? "", amountMinor: refund.amountMinor });

  if (result.status === "FAILED") {
    await prisma.refund.update({ where: { id: refundId }, data: { status: "FAILED" } });
    await writeAudit({ action: "REFUND_EXECUTED", adminId: executedById, meta: { refundId, result: "FAILED" } });
    throw new Error("The payment provider could not process this refund.");
  }

  const newPaymentStatus = refund.amountMinor >= payment.amountMinor ? "REFUNDED" : "PARTIALLY_REFUNDED";
  if (!isValidPaymentStatusTransition(payment.status, newPaymentStatus)) {
    throw new Error(`Cannot mark payment as ${newPaymentStatus} from status ${payment.status}`);
  }

  await prisma.$transaction([
    prisma.refund.update({ where: { id: refundId }, data: { status: "COMPLETED", completedAt: new Date(), providerRefundId: result.providerRefundId } }),
    prisma.payment.update({ where: { id: payment.id }, data: { status: newPaymentStatus, refundedAt: new Date() } }),
  ]);

  await writeAudit({ action: "REFUND_EXECUTED", adminId: executedById, targetProfileId: payment.profileId, meta: { refundId, result: "COMPLETED" } });
  await notifyRefundCompleted(payment.profileId);
}
