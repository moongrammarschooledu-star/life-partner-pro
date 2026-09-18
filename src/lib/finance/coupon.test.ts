import { describe, it, expect } from "vitest";
import { validateCoupon, type CouponValidationInput } from "./coupon";

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
});
