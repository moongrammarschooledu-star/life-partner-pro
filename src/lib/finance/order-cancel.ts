import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { isValidOrderStatusTransition, isValidPaymentStatusTransition } from "@/lib/finance/status-transitions";

// An applicant can withdraw an order that has not been paid and for which no bank-transfer reference was submitted. Found by the sandbox payment test:
// the status rules allow PENDING_PAYMENT -> CANCELLED, but no code path ever did it, so a customer could not abandon a checkout and the sandbox
// checklist item "Cancelled order" could never be completed. Money is never involved: once a reference exists the order belongs to the admin's
// verify/reject decision and can no longer be cancelled from here.

export async function cancelPendingOrder(params: { profileId: string; orderCode: string }): Promise<{ orderCode: string }> {
  const order = await prisma.order.findFirst({
    where: { orderCode: params.orderCode, profileId: params.profileId },
    include: { payments: { include: { manualDetail: true } } },
  });
  // The same answer for "no such order" and "someone else's order": nothing about other people's orders is revealed.
  if (!order) throw new HttpError(404, "Order not found.");

  if (!isValidOrderStatusTransition(order.status, "CANCELLED")) throw new HttpError(409, "This order can no longer be cancelled.");
  if (order.payments.some((p) => p.manualDetail || !isValidPaymentStatusTransition(p.status, "CANCELLED"))) {
    throw new HttpError(409, "A payment reference has already been submitted for this order, so it can no longer be cancelled here. Please contact support.");
  }

  await prisma.$transaction(async (tx) => {
    // Compare-and-set: only one of two simultaneous requests (or a Verify that lands first) wins the order.
    const claimed = await tx.order.updateMany({ where: { id: order.id, status: order.status }, data: { status: "CANCELLED" } });
    if (claimed.count !== 1) throw new HttpError(409, "This order can no longer be cancelled.");
    await tx.payment.updateMany({ where: { orderId: order.id, status: { in: order.payments.map((p) => p.status) } }, data: { status: "CANCELLED" } });
    // A coupon used on an order that was never paid is given back.
    await tx.couponRedemption.updateMany({ where: { orderId: order.id, status: "REDEEMED" }, data: { status: "RELEASED" } });
  });

  return { orderCode: order.orderCode };
}
