import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ALL, between, countOrGroup, metric, total } from "@/lib/analytics/metrics/helpers";
import type { MetricDefinition, MetricRow } from "@/lib/analytics/types";

// STEP 31 — finance and membership. Source of truth: the STEP 14/27 payment tables (Payment, Refund, Order, Subscription). All money
// is an integer in minor units and is reported PER CURRENCY — currencies are never added together. Revenue definitions:
//   Gross revenue  = payments that reached the paid state, by payment date.            (includes tax; before refunds)
//   Refunds        = completed refunds, by completion date.
//   Discounts      = coupon/promotion discounts on completed orders (information only: gross is already after discount).
//   Taxes          = tax charged on completed orders (included in gross).
//   Net revenue    = gross − refunds.            Net revenue (ex-tax) = gross − refunds − taxes.
// A refund is attributed to the period it completed in, not the period of the original payment.

const PAID_STATES = ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] as const;
const ORDER_DONE = ["PAID", "COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"] as const;

function moneyRows(rows: Array<{ currency: string; amount: bigint | number | null }>): MetricRow[] {
  return rows.map((r) => ({ dimensionValue: ALL, currency: r.currency, value: Number(r.amount ?? 0), denominator: null }));
}

async function gross(r: { startUtc: Date; endUtc: Date }): Promise<MetricRow[]> {
  const g = await prisma.payment.groupBy({ by: ["currencyCode"], where: { status: { in: [...PAID_STATES] }, paidAt: { gte: r.startUtc, lt: r.endUtc } }, _sum: { amountMinor: true } });
  return moneyRows(g.map((x) => ({ currency: x.currencyCode, amount: x._sum.amountMinor })));
}
async function refunds(r: { startUtc: Date; endUtc: Date }): Promise<MetricRow[]> {
  const rows = await prisma.$queryRaw<Array<{ currency: string; amount: bigint | null }>>(Prisma.sql`SELECT p."currencyCode" AS currency, SUM(rf."amountMinor")::bigint AS amount FROM "Refund" rf JOIN "Payment" p ON p.id = rf."paymentId" WHERE rf."status"::text = 'COMPLETED' AND rf."completedAt" >= ${r.startUtc} AND rf."completedAt" < ${r.endUtc} GROUP BY 1`);
  return moneyRows(rows);
}
async function orderSum(r: { startUtc: Date; endUtc: Date }, field: "discountMinor" | "taxMinor"): Promise<MetricRow[]> {
  const g = await prisma.order.groupBy({ by: ["currencyCode"], where: { status: { in: [...ORDER_DONE] }, completedAt: { gte: r.startUtc, lt: r.endUtc } }, _sum: { [field]: true } as never });
  return moneyRows(g.map((x) => ({ currency: x.currencyCode, amount: ((x as unknown as { _sum: Record<string, number | null> })._sum[field]) ?? 0 })));
}

// integer subtraction per currency (missing side counts as 0)
function subtract(a: MetricRow[], b: MetricRow[]): MetricRow[] {
  const map = new Map<string, number>();
  for (const x of a) map.set(x.currency, (map.get(x.currency) ?? 0) + x.value);
  for (const x of b) map.set(x.currency, (map.get(x.currency) ?? 0) - x.value);
  return [...map.entries()].map(([currency, value]) => ({ dimensionValue: ALL, currency, value, denominator: null }));
}

export const FINANCE_METRICS: MetricDefinition[] = [
  metric({
    key: "finance.gross_revenue", name: "Gross revenue", section: "finance", unit: "MINOR_MONEY", kind: "PERIOD",
    description: "Money received from payments that reached the paid state in the period, per currency (includes tax, before refunds).", formula: "Sum of payment amounts (minor units) with status PAID, PARTIALLY_REFUNDED or REFUNDED, by payment date.", source: "Payment.amountMinor, paidAt",
    exclusions: ["failed, pending, cancelled or expired payments"], requires: ["analytics:finance:view"], synonyms: ["gross revenue", "revenue", "payments received", "gross payments"],
    v1: (r) => gross(r),
  }),
  metric({
    key: "finance.refunds", name: "Refunds", section: "finance", unit: "MINOR_MONEY", kind: "PERIOD",
    description: "Refunds completed in the period, per currency.", formula: "Sum of refund amounts with status COMPLETED, by completion date.", source: "Refund.amountMinor, completedAt",
    requires: ["analytics:finance:view"], synonyms: ["refunds", "refunded"],
    v1: (r) => refunds(r),
  }),
  metric({
    key: "finance.discounts", name: "Discounts", section: "finance", unit: "MINOR_MONEY", kind: "PERIOD",
    description: "Coupon and promotion discounts on orders completed in the period (information only; gross revenue is already after discount).", formula: "Sum of order discounts for completed orders, by completion date.", source: "Order.discountMinor, completedAt",
    requires: ["analytics:finance:view"], synonyms: ["discounts", "coupon discounts"],
    v1: (r) => orderSum(r, "discountMinor"),
  }),
  metric({
    key: "finance.taxes", name: "Taxes", section: "finance", unit: "MINOR_MONEY", kind: "PERIOD",
    description: "Tax charged on orders completed in the period (included in gross revenue). Zero where no tax is configured.", formula: "Sum of order tax for completed orders, by completion date.", source: "Order.taxMinor, completedAt",
    requires: ["analytics:finance:view"], synonyms: ["taxes", "tax"],
    v1: (r) => orderSum(r, "taxMinor"),
  }),
  metric({
    key: "finance.net_revenue", name: "Net revenue", section: "finance", unit: "MINOR_MONEY", kind: "PERIOD",
    description: "Gross revenue minus refunds completed in the period, per currency.", formula: "Gross revenue − refunds.", source: "Payment, Refund",
    requires: ["analytics:finance:view"], synonyms: ["net revenue", "net income"],
    v1: async (r) => subtract(await gross(r), await refunds(r)),
  }),
  metric({
    key: "finance.net_revenue_ex_tax", name: "Net revenue (ex-tax)", section: "finance", unit: "MINOR_MONEY", kind: "PERIOD",
    description: "Gross revenue minus refunds minus taxes, per currency.", formula: "Gross revenue − refunds − taxes.", source: "Payment, Refund, Order",
    requires: ["analytics:finance:view"], synonyms: ["net revenue ex tax", "net of tax"],
    v1: async (r) => subtract(subtract(await gross(r), await refunds(r)), await orderSum(r, "taxMinor")),
  }),
  metric({
    key: "finance.payments_successful", name: "Successful payments", section: "finance", unit: "COUNT", kind: "PERIOD",
    description: "Payments that reached the paid state in the period.", formula: "Count of payments with a paid date in the period.", source: "Payment.paidAt",
    requires: ["analytics:finance:view"], synonyms: ["successful payments", "payments"],
    v1: async (r) => total(await prisma.payment.count({ where: { status: { in: [...PAID_STATES] }, paidAt: between(r) } })),
  }),
  metric({
    key: "finance.payments_failed", name: "Failed payments", section: "finance", unit: "COUNT", kind: "PERIOD",
    description: "Payments that failed in the period.", formula: "Count of payments with a failed time in the period.", source: "Payment.failedAt",
    requires: ["analytics:finance:view"], synonyms: ["failed payments", "payment failures"],
    v1: async (r) => total(await prisma.payment.count({ where: { failedAt: between(r) } })),
  }),
  metric({
    key: "finance.payment_failure_rate", name: "Payment failure rate", section: "finance", unit: "PERCENT", kind: "PERIOD", isRate: true,
    description: "Share of payment outcomes in the period that were failures.", formula: "Failed payments ÷ (failed + successful payments) in the period × 100.", source: "Payment.failedAt, paidAt",
    requires: ["analytics:finance:view"], synonyms: ["payment failure rate", "failure rate"],
    v1: async (r) => {
      const failed = await prisma.payment.count({ where: { failedAt: between(r) } });
      const paid = await prisma.payment.count({ where: { status: { in: [...PAID_STATES] }, paidAt: between(r) } });
      return total(failed, failed + paid);
    },
  }),
  metric({
    key: "finance.payment_methods", name: "Successful payments by method", section: "finance", unit: "COUNT", kind: "PERIOD",
    description: "Successful payments grouped by payment method.", formula: "Count of paid payments in the period grouped by method.", source: "Payment.method",
    dimensions: ["method"], requires: ["analytics:finance:view"], synonyms: ["payment methods", "payment method distribution"],
    v1: (r, _c, dim) => countOrGroup(prisma.payment as never, { status: { in: [...PAID_STATES] }, paidAt: between(r) }, dim, dim === "method" ? "method" : undefined),
  }),
  metric({
    key: "finance.stuck_payments", name: "Payments awaiting completion", section: "finance", unit: "COUNT", kind: "SNAPSHOT",
    description: "Payments still pending or processing more than a day after they were created (an outstanding-issue signal).", formula: "Count of payments in PENDING or PROCESSING status created more than 24 hours ago.", source: "Payment.status, createdAt",
    requires: ["analytics:finance:view"], synonyms: ["stuck payments", "outstanding payment issues", "pending payments"],
    v1: async (_r, ctx) => total(await prisma.payment.count({ where: { status: { in: ["PENDING", "PROCESSING"] }, createdAt: { lt: new Date(ctx.now.getTime() - 86_400_000) } } })),
  }),
];

const SUB_ACTIVE = ["ACTIVE", "TRIAL"] as const;

export const MEMBERSHIP_METRICS: MetricDefinition[] = [
  metric({
    key: "membership.subscriptions", name: "Subscriptions by status", section: "membership", unit: "COUNT", kind: "SNAPSHOT",
    description: "Subscriptions grouped by their current status (trial, active, past due, expired, cancelled, …).", formula: "Count of subscriptions grouped by status.", source: "Subscription.status",
    dimensions: ["status"], note: "A package changes which features an applicant can use; it does not change the quality or outcome of matchmaking.", synonyms: ["subscriptions", "memberships", "active subscriptions", "trial users", "expired subscriptions", "cancelled subscriptions"],
    v1: (_r, _c, dim) => countOrGroup(prisma.subscription as never, {}, dim, dim === "status" ? "status" : undefined),
  }),
  metric({
    key: "membership.active_memberships", name: "Active memberships", section: "executive", unit: "COUNT", kind: "SNAPSHOT",
    description: "Subscriptions that are active or in trial right now.", formula: "Count of subscriptions with status ACTIVE or TRIAL.", source: "Subscription.status",
    synonyms: ["active memberships", "paying members", "members"],
    v1: async () => total(await prisma.subscription.count({ where: { status: { in: [...SUB_ACTIVE] } } })),
  }),
  metric({
    key: "membership.free_applicants", name: "Applicants without a membership", section: "membership", unit: "COUNT", kind: "SNAPSHOT",
    description: "Applicants with no active or trial subscription.", formula: "Count of non-deleted profiles that have no ACTIVE or TRIAL subscription.", source: "Profile, Subscription",
    synonyms: ["free users", "free applicants", "no membership"],
    v1: async () => total(await prisma.profile.count({ where: { softDeleted: false, subscriptions: { none: { status: { in: [...SUB_ACTIVE] } } } } })),
  }),
  metric({
    key: "membership.expiring_30d", name: "Memberships expiring within 30 days", section: "membership", unit: "COUNT", kind: "SNAPSHOT",
    description: "Active or trial subscriptions whose end date falls in the next 30 days.", formula: "Count of ACTIVE/TRIAL subscriptions with an end date between now and 30 days from now.", source: "Subscription.endDate",
    synonyms: ["expiring subscriptions", "expiring memberships", "subscriptions expiring"],
    v1: async (_r, ctx) => total(await prisma.subscription.count({ where: { status: { in: [...SUB_ACTIVE] }, endDate: { gte: ctx.now, lte: new Date(ctx.now.getTime() + 30 * 86_400_000) } } })),
  }),
  metric({
    key: "membership.started", name: "Memberships started", section: "membership", unit: "COUNT", kind: "PERIOD",
    description: "Subscriptions started in the period.", formula: "Count of subscriptions whose start date is in the period.", source: "Subscription.startDate",
    dimensions: ["package"], synonyms: ["memberships started", "new subscriptions", "new members", "subscriptions started", "package distribution"],
    v1: (r, _c, dim) => countOrGroup(prisma.subscription as never, { startDate: between(r) }, dim, dim === "package" ? "packageId" : undefined),
  }),
  metric({
    key: "membership.package_distribution", name: "Subscribers by package", section: "membership", unit: "COUNT", kind: "SNAPSHOT",
    description: "Active and trial subscriptions grouped by package.", formula: "Count of ACTIVE/TRIAL subscriptions grouped by package.", source: "Subscription.packageId",
    dimensions: ["package"], synonyms: ["package distribution", "subscribers by package", "packages"],
    v1: (_r, _c, dim) => countOrGroup(prisma.subscription as never, { status: { in: [...SUB_ACTIVE] } }, dim, dim === "package" ? "packageId" : undefined),
  }),
  metric({
    key: "membership.cancelled", name: "Memberships cancelled", section: "membership", unit: "COUNT", kind: "PERIOD",
    description: "Subscriptions cancelled in the period.", formula: "Count of subscriptions whose cancellation time is in the period.", source: "Subscription.cancelledAt",
    synonyms: ["cancelled memberships", "cancellations", "memberships cancelled"],
    v1: async (r) => total(await prisma.subscription.count({ where: { cancelledAt: between(r) } })),
  }),
  metric({
    key: "membership.cancellation_rate", name: "Cancellation rate", section: "membership", unit: "PERCENT", kind: "PERIOD", isRate: true, liveOnly: true,
    description: "Cancellations in the period relative to subscriptions that were active or cancelled in it.", formula: "Cancelled in the period ÷ (active/trial now + cancelled in the period) × 100.", source: "Subscription",
    exclusions: ["approximation: uses the current active count"], synonyms: ["cancellation rate", "churn", "churn rate"],
    v1: async (r) => {
      const cancelled = await prisma.subscription.count({ where: { cancelledAt: between(r) } });
      const active = await prisma.subscription.count({ where: { status: { in: [...SUB_ACTIVE] } } });
      return total(cancelled, cancelled + active);
    },
  }),
  metric({
    key: "membership.renewals_due", name: "Renewals due", section: "membership", unit: "COUNT", kind: "PERIOD",
    description: "Subscriptions that reached their renewal date in the period.", formula: "Count of subscription events 'Renewal date reached — payment required' in the period.", source: "SubscriptionEvent",
    synonyms: ["renewals due"],
    v1: async (r) => total(await prisma.subscriptionEvent.count({ where: { reason: "Renewal date reached — payment required", createdAt: between(r) } })),
  }),
  metric({
    key: "membership.renewals_completed", name: "Renewals completed", section: "membership", unit: "COUNT", kind: "PERIOD",
    description: "Renewal payments confirmed in the period.", formula: "Count of subscription events 'Renewal payment confirmed' in the period.", source: "SubscriptionEvent",
    synonyms: ["renewals completed", "renewals"],
    v1: async (r) => total(await prisma.subscriptionEvent.count({ where: { reason: "Renewal payment confirmed", createdAt: between(r) } })),
  }),
  metric({
    key: "membership.renewal_rate", name: "Renewal rate", section: "membership", unit: "PERCENT", kind: "PERIOD", isRate: true,
    description: "Renewals confirmed in the period relative to renewals that fell due in it.", formula: "Renewals completed ÷ renewals due in the period × 100.", source: "SubscriptionEvent",
    exclusions: ["a renewal confirmed in a later period than its due date is counted when confirmed"], synonyms: ["renewal rate", "renewal"],
    v1: async (r) => total(
      await prisma.subscriptionEvent.count({ where: { reason: "Renewal payment confirmed", createdAt: between(r) } }),
      await prisma.subscriptionEvent.count({ where: { reason: "Renewal date reached — payment required", createdAt: between(r) } }),
    ),
  }),
  metric({
    key: "membership.coupons_redeemed", name: "Coupons redeemed", section: "membership", unit: "COUNT", kind: "PERIOD",
    description: "Coupon redemptions completed in the period.", formula: "Count of coupon redemptions with status REDEEMED in the period.", source: "CouponRedemption.redeemedAt",
    synonyms: ["coupon usage", "coupons used", "coupons redeemed", "coupons"],
    v1: async (r) => total(await prisma.couponRedemption.count({ where: { status: "REDEEMED", redeemedAt: between(r) } })),
  }),
  metric({
    key: "membership.referral_rewards", name: "Referral rewards granted", section: "membership", unit: "COUNT", kind: "PERIOD",
    description: "Referral rewards granted in the period.", formula: "Count of referrals whose reward time is in the period.", source: "Referral.rewardedAt",
    synonyms: ["referral rewards", "rewards granted"],
    v1: async (r) => total(await prisma.referral.count({ where: { rewardedAt: between(r) } })),
  }),
];
