import { prisma } from "@/lib/prisma";
import { applyPercent } from "@/lib/finance/money";
import type { Coupon } from "@prisma/client";

// Spec §21/§60 — backend validates every coupon; a client-supplied discount
// amount is never trusted. validateCoupon() only reads already-fetched data
// passed in (plus two count queries for usage limits) and returns either a
// computed discount or a rejection reason — the decision itself is a pure
// function of its inputs, kept separate from the DB round-trips in
// resolveCouponForOrder() below so it can be unit-tested without Prisma.
export interface CouponValidationInput {
  coupon: Pick<Coupon, "active" | "startDate" | "endDate" | "usageLimit" | "perUserLimit" | "minPurchaseMinor" | "maxDiscountMinor" | "discountType" | "discountValue" | "applicablePackageIds">;
  subtotalMinor: number;
  packageId: string;
  now: Date;
  totalRedemptions: number;
  userRedemptions: number;
}

export type CouponValidationResult = { ok: true; discountMinor: number } | { ok: false; reason: string };

export function validateCoupon(input: CouponValidationInput): CouponValidationResult {
  const { coupon, subtotalMinor, packageId, now, totalRedemptions, userRedemptions } = input;

  if (!coupon.active) return { ok: false, reason: "This coupon is no longer active." };
  if (coupon.startDate && now < coupon.startDate) return { ok: false, reason: "This coupon is not yet valid." };
  if (coupon.endDate && now > coupon.endDate) return { ok: false, reason: "This coupon has expired." };
  if (coupon.usageLimit != null && totalRedemptions >= coupon.usageLimit) return { ok: false, reason: "This coupon has reached its usage limit." };
  if (coupon.perUserLimit != null && userRedemptions >= coupon.perUserLimit) return { ok: false, reason: "You have already used this coupon the maximum number of times." };
  if (coupon.minPurchaseMinor != null && subtotalMinor < coupon.minPurchaseMinor) return { ok: false, reason: "This order does not meet the coupon's minimum purchase amount." };

  if (coupon.applicablePackageIds) {
    const ids = coupon.applicablePackageIds as string[];
    if (Array.isArray(ids) && ids.length > 0 && !ids.includes(packageId)) {
      return { ok: false, reason: "This coupon does not apply to the selected package." };
    }
  }

  let discountMinor = coupon.discountType === "PERCENTAGE" ? applyPercent(subtotalMinor, coupon.discountValue) : coupon.discountValue;
  if (coupon.maxDiscountMinor != null) discountMinor = Math.min(discountMinor, coupon.maxDiscountMinor);
  discountMinor = Math.min(discountMinor, subtotalMinor);

  return { ok: true, discountMinor };
}

export async function resolveCouponForOrder(code: string, profileId: string, packageId: string, subtotalMinor: number): Promise<CouponValidationResult & { couponId?: string }> {
  const coupon = await prisma.coupon.findUnique({ where: { code: code.trim().toUpperCase() } });
  if (!coupon) return { ok: false, reason: "Invalid coupon code." };

  const [totalRedemptions, userRedemptions] = await Promise.all([
    prisma.couponRedemption.count({ where: { couponId: coupon.id } }),
    prisma.couponRedemption.count({ where: { couponId: coupon.id, profileId } }),
  ]);

  const result = validateCoupon({ coupon, subtotalMinor, packageId, now: new Date(), totalRedemptions, userRedemptions });
  return result.ok ? { ...result, couponId: coupon.id } : result;
}
