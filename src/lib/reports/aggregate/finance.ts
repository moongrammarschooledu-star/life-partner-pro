import { prisma } from "@/lib/prisma";
import type { ReportFilters } from "@/lib/reports/types";

// Spec §33/§17 — a dedicated Finance report tab, mirroring
// computeCasesReport()/computePrivacyReport()'s precedent: Finance data
// needs sensitive-field permission gating and row-scoping the generic
// Custom Report Builder doesn't model, so a standalone aggregate is safer
// than wiring it in halfway. Sums are always precise integer minor-unit
// amounts (spec §31), never floats.
export async function computeFinanceReport(filters: ReportFilters) {
  const { from, to } = filters.dateRange;
  const where = { createdAt: { gte: from, lte: to } };

  const [revenueByMethod, revenueByStatus, paymentsByProvider, refundsByStatus, newSubscriptions, cancelledSubscriptions, failedPayments, couponRedemptions] = await Promise.all([
    prisma.payment.groupBy({ by: ["method"], where: { ...where, status: "PAID" }, _sum: { amountMinor: true }, _count: { method: true } }),
    prisma.payment.groupBy({ by: ["status"], where, _count: { status: true } }),
    prisma.payment.groupBy({ by: ["provider"], where: { ...where, status: "PAID" }, _sum: { amountMinor: true } }),
    prisma.refund.groupBy({ by: ["status"], where, _count: { status: true }, _sum: { amountMinor: true } }),
    prisma.subscription.count({ where: { createdAt: { gte: from, lte: to } } }),
    prisma.subscription.count({ where: { cancelledAt: { gte: from, lte: to } } }),
    prisma.payment.count({ where: { ...where, status: "FAILED" } }),
    prisma.couponRedemption.count({ where: { redeemedAt: { gte: from, lte: to } } }),
  ]);

  const grossRevenueMinor = revenueByMethod.reduce((sum, r) => sum + (r._sum.amountMinor ?? 0), 0);
  const totalRefundedMinor = refundsByStatus.filter((r) => r.status === "COMPLETED").reduce((sum, r) => sum + (r._sum.amountMinor ?? 0), 0);

  return {
    grossRevenueMinor,
    netRevenueMinor: grossRevenueMinor - totalRefundedMinor,
    revenueByMethod: revenueByMethod.map((r) => ({ label: r.method, sumMinor: r._sum.amountMinor ?? 0, count: r._count.method })),
    revenueByProvider: paymentsByProvider.map((r) => ({ label: r.provider, sumMinor: r._sum.amountMinor ?? 0 })),
    paymentsByStatus: revenueByStatus.map((r) => ({ label: r.status, count: r._count.status })),
    refundsByStatus: refundsByStatus.map((r) => ({ label: r.status, count: r._count.status, sumMinor: r._sum.amountMinor ?? 0 })),
    newSubscriptions,
    cancelledSubscriptions,
    failedPayments,
    couponRedemptions,
  };
}
