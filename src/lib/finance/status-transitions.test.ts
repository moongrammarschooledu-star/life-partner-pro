import { describe, it, expect } from "vitest";
import {
  isValidPaymentStatusTransition,
  isValidOrderStatusTransition,
  isValidRefundStatusTransition,
  isValidSubscriptionStatusTransition,
  isValidRolloutTransition,
  isValidReferralStatusTransition,
  isValidCouponRedemptionTransition,
  isValidPromotionLikeStatusTransition,
  isValidPackageVersionStatusTransition,
} from "./status-transitions";

describe("isValidPaymentStatusTransition", () => {
  it("allows the normal happy path", () => {
    expect(isValidPaymentStatusTransition("CREATED", "PENDING")).toBe(true);
    expect(isValidPaymentStatusTransition("PENDING", "PROCESSING")).toBe(true);
    expect(isValidPaymentStatusTransition("PROCESSING", "PAID")).toBe(true);
  });
  it("allows a paid payment to be refunded", () => {
    expect(isValidPaymentStatusTransition("PAID", "REFUNDED")).toBe(true);
    expect(isValidPaymentStatusTransition("PAID", "PARTIALLY_REFUNDED")).toBe(true);
  });
  it("rejects skipping straight from CREATED to PAID", () => {
    expect(isValidPaymentStatusTransition("CREATED", "PAID")).toBe(false);
  });
  it("rejects any transition out of a terminal state", () => {
    expect(isValidPaymentStatusTransition("REFUNDED", "PAID")).toBe(false);
    expect(isValidPaymentStatusTransition("CANCELLED", "PENDING")).toBe(false);
  });
  it("allows a failed payment to be retried", () => {
    expect(isValidPaymentStatusTransition("FAILED", "PENDING")).toBe(true);
  });
});

describe("isValidOrderStatusTransition", () => {
  it("allows the normal happy path", () => {
    expect(isValidOrderStatusTransition("DRAFT", "PENDING_PAYMENT")).toBe(true);
    expect(isValidOrderStatusTransition("PENDING_PAYMENT", "PAYMENT_PROCESSING")).toBe(true);
    expect(isValidOrderStatusTransition("PAYMENT_PROCESSING", "PAID")).toBe(true);
  });
  it("rejects skipping straight from DRAFT to PAID", () => {
    expect(isValidOrderStatusTransition("DRAFT", "PAID")).toBe(false);
  });
  it("rejects any transition out of CANCELLED", () => {
    expect(isValidOrderStatusTransition("CANCELLED", "PAID")).toBe(false);
  });
});

describe("isValidRefundStatusTransition", () => {
  it("allows the normal approval path", () => {
    expect(isValidRefundStatusTransition("REQUESTED", "PENDING_APPROVAL")).toBe(true);
    expect(isValidRefundStatusTransition("PENDING_APPROVAL", "APPROVED")).toBe(true);
    expect(isValidRefundStatusTransition("APPROVED", "PROCESSING")).toBe(true);
    expect(isValidRefundStatusTransition("PROCESSING", "COMPLETED")).toBe(true);
  });
  it("rejects re-processing an already-completed refund (idempotency guard)", () => {
    expect(isValidRefundStatusTransition("COMPLETED", "PROCESSING")).toBe(false);
    expect(isValidRefundStatusTransition("COMPLETED", "COMPLETED")).toBe(false);
  });
  it("rejects skipping approval entirely", () => {
    expect(isValidRefundStatusTransition("REQUESTED", "PROCESSING")).toBe(false);
  });
  it("allows rejection from either requested or pending-approval", () => {
    expect(isValidRefundStatusTransition("REQUESTED", "REJECTED")).toBe(true);
    expect(isValidRefundStatusTransition("PENDING_APPROVAL", "REJECTED")).toBe(true);
  });
});

describe("isValidSubscriptionStatusTransition", () => {
  it("allows the grace-period path (spec §25)", () => {
    expect(isValidSubscriptionStatusTransition("ACTIVE", "PAST_DUE")).toBe(true);
    expect(isValidSubscriptionStatusTransition("PAST_DUE", "GRACE_PERIOD")).toBe(true);
    expect(isValidSubscriptionStatusTransition("GRACE_PERIOD", "EXPIRED")).toBe(true);
  });
  it("allows recovering from past-due or grace period back to active", () => {
    expect(isValidSubscriptionStatusTransition("PAST_DUE", "ACTIVE")).toBe(true);
    expect(isValidSubscriptionStatusTransition("GRACE_PERIOD", "ACTIVE")).toBe(true);
  });
  it("rejects any transition out of CANCELLED", () => {
    expect(isValidSubscriptionStatusTransition("CANCELLED", "ACTIVE")).toBe(false);
  });
  it("allows reactivation from EXPIRED via a new successful payment", () => {
    expect(isValidSubscriptionStatusTransition("EXPIRED", "ACTIVE")).toBe(true);
  });
});

describe("isValidRolloutTransition", () => {
  it("allows forward progression one stage at a time", () => {
    expect(isValidRolloutTransition("DISABLED", "SANDBOX")).toBe(true);
    expect(isValidRolloutTransition("SANDBOX", "INTERNAL")).toBe(true);
    expect(isValidRolloutTransition("INTERNAL", "BETA")).toBe(true);
    expect(isValidRolloutTransition("BETA", "PRODUCTION")).toBe(true);
  });
  it("rejects skipping a stage", () => {
    expect(isValidRolloutTransition("DISABLED", "INTERNAL")).toBe(false);
    expect(isValidRolloutTransition("DISABLED", "BETA")).toBe(false);
    expect(isValidRolloutTransition("DISABLED", "PRODUCTION")).toBe(false);
    expect(isValidRolloutTransition("SANDBOX", "BETA")).toBe(false);
    expect(isValidRolloutTransition("SANDBOX", "PRODUCTION")).toBe(false);
    expect(isValidRolloutTransition("INTERNAL", "PRODUCTION")).toBe(false);
  });
  it("allows the kill switch from every active stage", () => {
    expect(isValidRolloutTransition("SANDBOX", "DISABLED")).toBe(true);
    expect(isValidRolloutTransition("INTERNAL", "DISABLED")).toBe(true);
    expect(isValidRolloutTransition("BETA", "DISABLED")).toBe(true);
    expect(isValidRolloutTransition("PRODUCTION", "DISABLED")).toBe(true);
  });
  it("rejects any lateral or backward move that bypasses DISABLED", () => {
    expect(isValidRolloutTransition("PRODUCTION", "BETA")).toBe(false);
    expect(isValidRolloutTransition("BETA", "INTERNAL")).toBe(false);
    expect(isValidRolloutTransition("INTERNAL", "SANDBOX")).toBe(false);
    expect(isValidRolloutTransition("PRODUCTION", "SANDBOX")).toBe(false);
  });
  it("rejects a no-op transition to the same stage", () => {
    expect(isValidRolloutTransition("PRODUCTION", "PRODUCTION")).toBe(false);
    expect(isValidRolloutTransition("DISABLED", "DISABLED")).toBe(false);
  });
});

// ---------- STEP 27 ----------

describe("isValidReferralStatusTransition", () => {
  it("allows the normal qualifying path", () => {
    expect(isValidReferralStatusTransition("PENDING", "LINKED")).toBe(true);
    expect(isValidReferralStatusTransition("LINKED", "QUALIFIED")).toBe(true);
    expect(isValidReferralStatusTransition("QUALIFIED", "REWARDED")).toBe(true);
  });
  it("allows a review-required detour back to QUALIFIED or to REJECTED", () => {
    expect(isValidReferralStatusTransition("QUALIFIED", "REFERRAL_REVIEW_REQUIRED")).toBe(true);
    expect(isValidReferralStatusTransition("REFERRAL_REVIEW_REQUIRED", "QUALIFIED")).toBe(true);
    expect(isValidReferralStatusTransition("REFERRAL_REVIEW_REQUIRED", "REJECTED")).toBe(true);
  });
  it("rejects skipping straight from PENDING to REWARDED", () => {
    expect(isValidReferralStatusTransition("PENDING", "REWARDED")).toBe(false);
  });
  it("rejects any transition out of a terminal state", () => {
    expect(isValidReferralStatusTransition("REWARDED", "QUALIFIED")).toBe(false);
    expect(isValidReferralStatusTransition("REJECTED", "QUALIFIED")).toBe(false);
  });
});

describe("isValidCouponRedemptionTransition", () => {
  it("allows a reservation to be redeemed, released, or to expire", () => {
    expect(isValidCouponRedemptionTransition("RESERVED", "REDEEMED")).toBe(true);
    expect(isValidCouponRedemptionTransition("RESERVED", "RELEASED")).toBe(true);
    expect(isValidCouponRedemptionTransition("RESERVED", "EXPIRED")).toBe(true);
  });
  it("allows a redeemed coupon to be reversed (refund/cancellation)", () => {
    expect(isValidCouponRedemptionTransition("REDEEMED", "REVERSED")).toBe(true);
  });
  it("rejects re-redeeming an already-redeemed or released/expired/reversed row", () => {
    expect(isValidCouponRedemptionTransition("REDEEMED", "REDEEMED")).toBe(false);
    expect(isValidCouponRedemptionTransition("RELEASED", "REDEEMED")).toBe(false);
    expect(isValidCouponRedemptionTransition("EXPIRED", "REDEEMED")).toBe(false);
    expect(isValidCouponRedemptionTransition("REVERSED", "REDEEMED")).toBe(false);
  });
});

describe("isValidPromotionLikeStatusTransition", () => {
  it("allows the normal lifecycle", () => {
    expect(isValidPromotionLikeStatusTransition("DRAFT", "ACTIVE")).toBe(true);
    expect(isValidPromotionLikeStatusTransition("ACTIVE", "PAUSED")).toBe(true);
    expect(isValidPromotionLikeStatusTransition("PAUSED", "ACTIVE")).toBe(true);
    expect(isValidPromotionLikeStatusTransition("ACTIVE", "ENDED")).toBe(true);
    expect(isValidPromotionLikeStatusTransition("ENDED", "ARCHIVED")).toBe(true);
  });
  it("rejects reactivating an ended or archived promotion", () => {
    expect(isValidPromotionLikeStatusTransition("ENDED", "ACTIVE")).toBe(false);
    expect(isValidPromotionLikeStatusTransition("ARCHIVED", "ACTIVE")).toBe(false);
  });
});

describe("isValidPackageVersionStatusTransition", () => {
  it("allows the normal approval path", () => {
    expect(isValidPackageVersionStatusTransition("DRAFT", "PENDING_APPROVAL")).toBe(true);
    expect(isValidPackageVersionStatusTransition("PENDING_APPROVAL", "APPROVED")).toBe(true);
    expect(isValidPackageVersionStatusTransition("APPROVED", "ACTIVE")).toBe(true);
    expect(isValidPackageVersionStatusTransition("ACTIVE", "SUPERSEDED")).toBe(true);
  });
  it("rejects skipping approval and going straight to ACTIVE", () => {
    expect(isValidPackageVersionStatusTransition("DRAFT", "ACTIVE")).toBe(false);
  });
  it("rejects reviving a rejected or superseded version", () => {
    expect(isValidPackageVersionStatusTransition("REJECTED", "PENDING_APPROVAL")).toBe(false);
    expect(isValidPackageVersionStatusTransition("SUPERSEDED", "ACTIVE")).toBe(false);
  });
});
