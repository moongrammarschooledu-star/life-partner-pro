import type { PaymentStatus, OrderStatus, RefundStatus, SubscriptionStatus } from "@prisma/client";

// Spec §56 — no arbitrary status changes. Every mutation route calls one of
// these before writing a new status; an invalid transition is rejected with
// 400 before touching the database. Pure lookup tables, no I/O — testable
// without Prisma/next-auth, matching this codebase's established
// vitest-coverage convention.

const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  CREATED: ["PENDING", "PROCESSING", "CANCELLED", "EXPIRED"],
  PENDING: ["PROCESSING", "FAILED", "CANCELLED", "EXPIRED"],
  PROCESSING: ["PAID", "FAILED"],
  PAID: ["REFUNDED", "PARTIALLY_REFUNDED", "DISPUTED"],
  FAILED: ["PENDING", "PROCESSING"], // retry
  CANCELLED: [],
  REFUNDED: [],
  PARTIALLY_REFUNDED: ["REFUNDED"],
  DISPUTED: ["PAID", "REFUNDED"],
  EXPIRED: [],
};

export function isValidPaymentStatusTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ["PENDING_PAYMENT", "CANCELLED"],
  PENDING_PAYMENT: ["PAYMENT_PROCESSING", "FAILED", "CANCELLED"],
  PAYMENT_PROCESSING: ["PAID", "FAILED"],
  PAID: ["COMPLETED", "REFUNDED", "PARTIALLY_REFUNDED"],
  FAILED: ["PENDING_PAYMENT"], // retry
  CANCELLED: [],
  REFUNDED: [],
  PARTIALLY_REFUNDED: ["REFUNDED"],
  COMPLETED: ["REFUNDED", "PARTIALLY_REFUNDED"],
};

export function isValidOrderStatusTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

const REFUND_TRANSITIONS: Record<RefundStatus, RefundStatus[]> = {
  REQUESTED: ["PENDING_APPROVAL", "CANCELLED", "REJECTED"],
  PENDING_APPROVAL: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["PROCESSING", "FAILED", "CANCELLED"],
  PROCESSING: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: ["PENDING_APPROVAL"], // retry from approval
  REJECTED: [],
  CANCELLED: [],
};

export function isValidRefundStatusTransition(from: RefundStatus, to: RefundStatus): boolean {
  return REFUND_TRANSITIONS[from]?.includes(to) ?? false;
}

const SUBSCRIPTION_TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  PENDING: ["TRIAL", "ACTIVE", "PAYMENT_FAILED", "CANCELLED"],
  TRIAL: ["ACTIVE", "PAYMENT_FAILED", "CANCELLED", "EXPIRED"],
  ACTIVE: ["PAST_DUE", "CANCELLED", "SUSPENDED", "EXPIRED"],
  PAST_DUE: ["GRACE_PERIOD", "ACTIVE", "EXPIRED", "CANCELLED"],
  GRACE_PERIOD: ["ACTIVE", "EXPIRED", "CANCELLED"],
  PAYMENT_FAILED: ["ACTIVE", "PAST_DUE", "CANCELLED", "EXPIRED"],
  CANCELLED: [],
  EXPIRED: ["ACTIVE"], // reactivation via a new successful payment
  SUSPENDED: ["ACTIVE", "CANCELLED"],
};

export function isValidSubscriptionStatusTransition(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
  return SUBSCRIPTION_TRANSITIONS[from]?.includes(to) ?? false;
}
