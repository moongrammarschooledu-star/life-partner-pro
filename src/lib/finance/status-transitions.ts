import type { PaymentStatus, OrderStatus, RefundStatus, SubscriptionStatus, PaymentRolloutStage, ReferralStatus, CouponRedemptionStatus, PromotionLikeStatus, PackageVersionStatus } from "@prisma/client";

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

// Payment Rollout Phases (STEP 14 add-on §83) — forward-only progression,
// no skipping stages, plus a universal any-state kill switch to DISABLED.
// There is no direct lateral/backward move (e.g. PRODUCTION -> BETA):
// stepping back requires the same reauth-gated path back through DISABLED,
// so a rollback is always an explicit, auditable, from-scratch decision.
const ROLLOUT_TRANSITIONS: Record<PaymentRolloutStage, PaymentRolloutStage[]> = {
  DISABLED: ["SANDBOX"],
  SANDBOX: ["INTERNAL", "DISABLED"],
  INTERNAL: ["BETA", "DISABLED"],
  BETA: ["PRODUCTION", "DISABLED"],
  PRODUCTION: ["DISABLED"],
};

export function isValidRolloutTransition(from: PaymentRolloutStage, to: PaymentRolloutStage): boolean {
  return ROLLOUT_TRANSITIONS[from]?.includes(to) ?? false;
}

// ---------- STEP 27 — Membership, Packages, Entitlements, Coupons & Referrals ----------

const REFERRAL_TRANSITIONS: Record<ReferralStatus, ReferralStatus[]> = {
  PENDING: ["LINKED", "EXPIRED"],
  LINKED: ["QUALIFIED", "EXPIRED"],
  QUALIFIED: ["REWARDED", "REFERRAL_REVIEW_REQUIRED", "REJECTED", "EXPIRED"],
  REWARDED: [],
  REFERRAL_REVIEW_REQUIRED: ["QUALIFIED", "REJECTED"],
  REJECTED: [],
  EXPIRED: [],
};

export function isValidReferralStatusTransition(from: ReferralStatus, to: ReferralStatus): boolean {
  return REFERRAL_TRANSITIONS[from]?.includes(to) ?? false;
}

// A reservation and its eventual redemption are the same row (spec §34) —
// this is the row's own lifecycle, not two separate tables.
const COUPON_REDEMPTION_TRANSITIONS: Record<CouponRedemptionStatus, CouponRedemptionStatus[]> = {
  RESERVED: ["REDEEMED", "RELEASED", "EXPIRED"],
  REDEEMED: ["REVERSED"],
  RELEASED: [],
  REVERSED: [],
  EXPIRED: [],
};

export function isValidCouponRedemptionTransition(from: CouponRedemptionStatus, to: CouponRedemptionStatus): boolean {
  return COUPON_REDEMPTION_TRANSITIONS[from]?.includes(to) ?? false;
}

// Shared by ReferralProgram and Promotion (both use PromotionLikeStatus).
const PROMOTION_LIKE_TRANSITIONS: Record<PromotionLikeStatus, PromotionLikeStatus[]> = {
  DRAFT: ["SCHEDULED", "ACTIVE", "ARCHIVED"],
  SCHEDULED: ["ACTIVE", "PAUSED", "ARCHIVED"],
  ACTIVE: ["PAUSED", "ENDED"],
  PAUSED: ["ACTIVE", "ENDED"],
  ENDED: ["ARCHIVED"],
  ARCHIVED: [],
};

export function isValidPromotionLikeStatusTransition(from: PromotionLikeStatus, to: PromotionLikeStatus): boolean {
  return PROMOTION_LIKE_TRANSITIONS[from]?.includes(to) ?? false;
}

const PACKAGE_VERSION_TRANSITIONS: Record<PackageVersionStatus, PackageVersionStatus[]> = {
  DRAFT: ["PENDING_APPROVAL", "REJECTED"],
  PENDING_APPROVAL: ["APPROVED", "REJECTED"],
  APPROVED: ["ACTIVE"],
  ACTIVE: ["SUPERSEDED"],
  SUPERSEDED: [],
  REJECTED: [],
};

export function isValidPackageVersionStatusTransition(from: PackageVersionStatus, to: PackageVersionStatus): boolean {
  return PACKAGE_VERSION_TRANSITIONS[from]?.includes(to) ?? false;
}
