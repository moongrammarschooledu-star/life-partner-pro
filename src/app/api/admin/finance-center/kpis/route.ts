import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";

// Spec §31 — precise financial calculations (integer minor-unit sums, no
// float arithmetic).
export async function GET() {
  try {
    await requireAdmin("finance:dashboard:view");

    const [grossRevenue, refundedTotal, successfulPayments, pendingPayments, failedPayments, refundCount, activeSubscriptions, expiringSubscriptions, cancelledSubscriptions, outstandingOrders] = await Promise.all([
      prisma.payment.aggregate({ where: { status: { in: ["PAID", "PARTIALLY_REFUNDED"] } }, _sum: { amountMinor: true } }),
      prisma.refund.aggregate({ where: { status: "COMPLETED" }, _sum: { amountMinor: true } }),
      prisma.payment.count({ where: { status: "PAID" } }),
      prisma.payment.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } }),
      prisma.payment.count({ where: { status: "FAILED" } }),
      prisma.refund.count({ where: { status: "COMPLETED" } }),
      prisma.subscription.count({ where: { status: "ACTIVE" } }),
      prisma.subscription.count({ where: { status: { in: ["PAST_DUE", "GRACE_PERIOD"] } } }),
      prisma.subscription.count({ where: { status: "CANCELLED" } }),
      prisma.order.aggregate({ where: { status: "PENDING_PAYMENT" }, _sum: { totalMinor: true } }),
    ]);

    const gross = grossRevenue._sum.amountMinor ?? 0;
    const refunded = refundedTotal._sum.amountMinor ?? 0;

    return NextResponse.json({
      grossRevenueMinor: gross,
      netRevenueMinor: gross - refunded,
      successfulPayments,
      pendingPayments,
      failedPayments,
      refundsMinor: refunded,
      refundCount,
      activeSubscriptions,
      expiringSubscriptions,
      cancelledSubscriptions,
      outstandingAmountMinor: outstandingOrders._sum.totalMinor ?? 0,
      averageTransactionValueMinor: successfulPayments > 0 ? Math.round(gross / successfulPayments) : 0,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
