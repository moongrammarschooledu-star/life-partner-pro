import { describe, it, expect } from "vitest";
import { validateCoupon, resolveCouponEffect, type CouponValidationInput } from "./coupon";

function baseInput(overrides: Partial<CouponValidationInput["coupon"]> = {}): CouponValidationInput {
  return {
    coupon: {
      active: true,
      startDate: null,
      endDate: null,
      usageLimit: null,
      perUserLimit: null,
      minPurchaseMinor: null,
      maxDiscountMinor: null,
      discountType: "PERCENTAGE",
      discountValue: 10,
      applicablePackageIds: null,
      currencyCode: null,
      allowedCountries: null,
      firstTimeUserOnly: false,
      allowedSubscriptionTypes: null,
      requiresReferralEligibility: false,
      ...overrides,
    },
    subtotalMinor: 100000,
    packageId: "pkg-1",
    now: new Date("2026-06-01T00:00:00Z"),
    totalRedemptions: 0,
    userRedemptions: 0,
  };
}

describe("validateCoupon", () => {
  it("accepts a valid unrestricted percentage coupon", () => {
    const result = validateCoupon(baseInput());
    expect(result).toEqual({ ok: true, discountMinor: 10000 });
  });

  it("rejects an inactive coupon", () => {
    const result = validateCoupon(baseInput({ active: false }));
    expect(result.ok).toBe(false);
  });

  it("rejects a coupon that hasn't started yet", () => {
    const result = validateCoupon(baseInput({ startDate: new Date("2026-07-01T00:00:00Z") }));
    expect(result.ok).toBe(false);
  });

  it("rejects an expired coupon", () => {
    const result = validateCoupon(baseInput({ endDate: new Date("2026-01-01T00:00:00Z") }));
    expect(result.ok).toBe(false);
  });

  it("rejects when the total usage limit has been reached", () => {
    const input = baseInput({ usageLimit: 5 });
    input.totalRedemptions = 5;
    expect(validateCoupon(input).ok).toBe(false);
  });

  it("rejects when the per-user limit has been reached (even if the total limit has room)", () => {
    const input = baseInput({ perUserLimit: 1, usageLimit: 100 });
    input.userRedemptions = 1;
    input.totalRedemptions = 3;
    expect(validateCoupon(input).ok).toBe(false);
  });

  it("rejects when the order doesn't meet the minimum purchase amount", () => {
    const input = baseInput({ minPurchaseMinor: 200000 });
    expect(validateCoupon(input).ok).toBe(false);
  });

  it("rejects a coupon not applicable to the selected package", () => {
    const input = baseInput({ applicablePackageIds: ["pkg-2", "pkg-3"] });
    expect(validateCoupon(input).ok).toBe(false);
  });

  it("accepts when the selected package is in the applicable list", () => {
    const input = baseInput({ applicablePackageIds: ["pkg-1", "pkg-2"] });
    expect(validateCoupon(input).ok).toBe(true);
  });

  it("caps a percentage discount at maxDiscountMinor", () => {
    const input = baseInput({ discountType: "PERCENTAGE", discountValue: 50, maxDiscountMinor: 20000 });
    const result = validateCoupon(input);
    expect(result).toEqual({ ok: true, discountMinor: 20000 });
  });

  it("never discounts more than the order subtotal itself", () => {
    const input = baseInput({ discountType: "FIXED_AMOUNT", discountValue: 999999 });
    const result = validateCoupon(input);
    expect(result).toEqual({ ok: true, discountMinor: 100000 });
  });

  it("computes a fixed-amount discount directly", () => {
    const input = baseInput({ discountType: "FIXED_AMOUNT", discountValue: 5000 });
    const result = validateCoupon(input);
    expect(result).toEqual({ ok: true, discountMinor: 5000 });
  });

  // ---------- STEP 27 §31 — additive conditions ----------
  it("rejects a currency-restricted coupon when the caller's currency doesn't match", () => {
    const input = baseInput({ currencyCode: "USD" });
    expect(validateCoupon({ ...input, currencyCode: "PKR" }).ok).toBe(false);
  });

  it("accepts a currency-restricted coupon when the currency matches", () => {
    const input = baseInput({ currencyCode: "PKR" });
    expect(validateCoupon({ ...input, currencyCode: "PKR" }).ok).toBe(true);
  });

  it("fails closed when a coupon restricts currency but the caller didn't supply one", () => {
    const input = baseInput({ currencyCode: "PKR" });
    expect(validateCoupon(input).ok).toBe(false); // input.currencyCode left undefined
  });

  it("rejects a country-restricted coupon outside the allowed list", () => {
    const input = baseInput({ allowedCountries: ["PK", "AE"] });
    expect(validateCoupon({ ...input, country: "IN" }).ok).toBe(false);
  });

  it("fails closed when a coupon restricts country but the caller didn't supply one", () => {
    const input = baseInput({ allowedCountries: ["PK"] });
    expect(validateCoupon(input).ok).toBe(false);
  });

  it("rejects a first-time-user-only coupon for a returning customer", () => {
    const input = baseInput({ firstTimeUserOnly: true });
    expect(validateCoupon({ ...input, isFirstTimeUser: false }).ok).toBe(false);
  });

  it("fails closed when a coupon is first-time-user-only but the caller didn't say", () => {
    const input = baseInput({ firstTimeUserOnly: true });
    expect(validateCoupon(input).ok).toBe(false);
  });

  it("accepts a first-time-user-only coupon for a genuine first-time customer", () => {
    const input = baseInput({ firstTimeUserOnly: true });
    expect(validateCoupon({ ...input, isFirstTimeUser: true }).ok).toBe(true);
  });

  it("rejects a subscription-type-restricted coupon for a mismatched package type", () => {
    const input = baseInput({ allowedSubscriptionTypes: ["SUBSCRIPTION"] });
    expect(validateCoupon({ ...input, subscriptionType: "ONE_TIME" }).ok).toBe(false);
  });

  it("treats FREE_TRIAL/FREE_FEATURE/CREDIT as a zero checkout-price discount", () => {
    expect(validateCoupon(baseInput({ discountType: "FREE_TRIAL", discountValue: 30 })).ok).toBe(true);
    expect(validateCoupon(baseInput({ discountType: "FREE_TRIAL", discountValue: 30 }))).toEqual({ ok: true, discountMinor: 0 });
    expect(validateCoupon(baseInput({ discountType: "CREDIT", discountValue: 50000 }))).toEqual({ ok: true, discountMinor: 0 });
  });
});

describe("resolveCouponEffect", () => {
  it("dispatches FREE_TRIAL as a day count", () => {
    expect(resolveCouponEffect({ discountType: "FREE_TRIAL", discountValue: 30, currencyCode: null, freeFeatureKey: null })).toEqual({ kind: "TRIAL_DAYS", days: 30 });
  });
  it("dispatches CREDIT as a minor-unit amount, defaulting currency to PKR", () => {
    expect(resolveCouponEffect({ discountType: "CREDIT", discountValue: 50000, currencyCode: null, freeFeatureKey: null })).toEqual({ kind: "CREDIT", amountMinor: 50000, currencyCode: "PKR" });
    expect(resolveCouponEffect({ discountType: "CREDIT", discountValue: 50000, currencyCode: "USD", freeFeatureKey: null })).toEqual({ kind: "CREDIT", amountMinor: 50000, currencyCode: "USD" });
  });
  it("dispatches FREE_FEATURE only when a feature key is configured", () => {
    expect(resolveCouponEffect({ discountType: "FREE_FEATURE", discountValue: 0, currencyCode: null, freeFeatureKey: "AI_ASSISTANCE" })).toEqual({ kind: "FREE_FEATURE", featureKey: "AI_ASSISTANCE" });
    expect(resolveCouponEffect({ discountType: "FREE_FEATURE", discountValue: 0, currencyCode: null, freeFeatureKey: null })).toEqual({ kind: "NONE" });
  });
  it("has no non-monetary effect for PERCENTAGE/FIXED_AMOUNT", () => {
    expect(resolveCouponEffect({ discountType: "PERCENTAGE", discountValue: 10, currencyCode: null, freeFeatureKey: null })).toEqual({ kind: "NONE" });
  });
});
