import { prisma } from "@/lib/prisma";
import { applyPercent } from "@/lib/finance/money";
import { writeAudit } from "@/lib/audit";
import type { Coupon } from "@prisma/client";

// Spec §21/§60 — backend validates every coupon; a client-supplied discount
// amount is never trusted. validateCoupon() only reads already-fetched data
// passed in (plus two count queries for usage limits) and returns either a
// computed discount or a rejection reason — the decision itself is a pure
// function of its inputs, kept separate from the DB round-trips in
// resolveCouponForOrder() below so it can be unit-tested without Prisma.
export interface CouponValidationInput {
  coupon: Pick<
    Coupon,
    | "active"
    | "startDate"
    | "endDate"
    | "usageLimit"
    | "perUserLimit"
    | "minPurchaseMinor"
    | "maxDiscountMinor"
    | "discountType"
    | "discountValue"
    | "applicablePackageIds"
    | "currencyCode"
    | "allowedCountries"
    | "firstTimeUserOnly"
    | "allowedSubscriptionTypes"
    | "requiresReferralEligibility"
  >;
  subtotalMinor: number;
  packageId: string;
  now: Date;
  totalRedemptions: number;
  userRedemptions: number;
  // STEP 27 §31 — additive, optional. When a Coupon column restricts an
  // axis (e.g. currencyCode is set) but the caller didn't supply the
  // matching input, validation FAILS CLOSED (rejects) rather than silently
  // treating it as unrestricted — a caller that hasn't been upgraded to
  // pass the new context must never become a coupon-abuse hole.
  currencyCode?: string;
  country?: string;
  isFirstTimeUser?: boolean;
  subscriptionType?: string; // a PackageType value
  isReferralEligible?: boolean;
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

  if (coupon.currencyCode != null) {
    if (input.currencyCode == null || input.currencyCode !== coupon.currencyCode) return { ok: false, reason: "This coupon is not valid for the selected currency." };
  }
  if (coupon.allowedCountries) {
    const countries = coupon.allowedCountries as string[];
    if (Array.isArray(countries) && countries.length > 0) {
      if (input.country == null || !countries.includes(input.country)) return { ok: false, reason: "This coupon is not valid in your region." };
    }
  }
  if (coupon.firstTimeUserOnly) {
    if (input.isFirstTimeUser == null || !input.isFirstTimeUser) return { ok: false, reason: "This coupon is only valid for first-time customers." };
  }
  if (coupon.allowedSubscriptionTypes) {
    const types = coupon.allowedSubscriptionTypes as string[];
    if (Array.isArray(types) && types.length > 0) {
      if (input.subscriptionType == null || !types.includes(input.subscriptionType)) return { ok: false, reason: "This coupon does not apply to the selected package type." };
    }
  }
  if (coupon.requiresReferralEligibility) {
    if (input.isReferralEligible == null || !input.isReferralEligible) return { ok: false, reason: "This coupon requires referral program eligibility." };
  }

  // FREE_TRIAL/FREE_FEATURE/CREDIT are not a checkout-price discount — they
  // are dispatched separately (grantCouponEffect below) once the order is
  // confirmed. Only PERCENTAGE/FIXED_AMOUNT reduce the checkout total here.
  let discountMinor = 0;
  if (coupon.discountType === "PERCENTAGE") discountMinor = applyPercent(subtotalMinor, coupon.discountValue);
  else if (coupon.discountType === "FIXED_AMOUNT") discountMinor = coupon.discountValue;

  if (coupon.maxDiscountMinor != null) discountMinor = Math.min(discountMinor, coupon.maxDiscountMinor);
  discountMinor = Math.min(discountMinor, subtotalMinor);

  return { ok: true, discountMinor };
}

export interface ResolveCouponContext {
  currencyCode?: string;
  country?: string;
  isFirstTimeUser?: boolean;
  subscriptionType?: string;
  isReferralEligible?: boolean;
}

export async function resolveCouponForOrder(
  code: string,
  profileId: string,
  packageId: string,
  subtotalMinor: number,
  context: ResolveCouponContext = {},
): Promise<CouponValidationResult & { couponId?: string }> {
  const coupon = await prisma.coupon.findUnique({ where: { code: code.trim().toUpperCase() } });
  if (!coupon) return { ok: false, reason: "Invalid coupon code." };

  // STEP 27 §34 — only REDEEMED counts toward usage limits; a RELEASED
  // (abandoned reservation) or REVERSED (order later cancelled/refunded)
  // redemption never counts, closing the cancel-and-retry abuse loophole.
  // EXPIRED reservations are likewise excluded.
  const [totalRedemptions, userRedemptions] = await Promise.all([
    prisma.couponRedemption.count({ where: { couponId: coupon.id, status: "REDEEMED" } }),
    prisma.couponRedemption.count({ where: { couponId: coupon.id, profileId, status: "REDEEMED" } }),
  ]);

  const result = validateCoupon({ coupon, subtotalMinor, packageId, now: new Date(), totalRedemptions, userRedemptions, ...context });
  return result.ok ? { ...result, couponId: coupon.id } : result;
}

// STEP 27 §34 — used when checkout has multiple steps before final
// confirmation (e.g. a provider-hosted checkout redirect): the coupon is
// held with a short expiry, without yet linking an Order, so it can't be
// double-spent by another concurrent checkout for the same profile.
export async function reserveCoupon(
  code: string,
  profileId: string,
  packageId: string,
  subtotalMinor: number,
  context: ResolveCouponContext = {},
  ttlMinutes = 20,
): Promise<CouponValidationResult & { redemptionId?: string; couponId?: string }> {
  const resolved = await resolveCouponForOrder(code, profileId, packageId, subtotalMinor, context);
  if (!resolved.ok) return resolved;

  const redemption = await prisma.couponRedemption.create({
    data: {
      couponId: resolved.couponId!,
      profileId,
      discountAppliedMinor: resolved.discountMinor,
      status: "RESERVED",
      reservedAt: new Date(),
      expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
    },
  });
  return { ...resolved, redemptionId: redemption.id };
}

export async function redeemReservedCoupon(redemptionId: string, orderId: string) {
  return prisma.couponRedemption.update({ where: { id: redemptionId }, data: { status: "REDEEMED", orderId, redeemedAt: new Date() } });
}

// Checkout abandoned before payment — the reservation no longer counts
// toward usage limits, freeing it up immediately rather than waiting for
// its TTL to lapse into EXPIRED.
export async function releaseCoupon(redemptionId: string) {
  return prisma.couponRedemption.update({ where: { id: redemptionId }, data: { status: "RELEASED" } });
}

// Order cancelled/refunded after the fact — a reversed redemption is
// excluded from usageLimit/perUserLimit counts going forward.
export async function reverseCoupon(redemptionId: string, actorId?: string) {
  const updated = await prisma.couponRedemption.update({ where: { id: redemptionId }, data: { status: "REVERSED" } });
  await writeAudit({ action: "COUPON_REVOKED", adminId: actorId, targetProfileId: updated.profileId, meta: { redemptionId, couponId: updated.couponId } });
  return updated;
}

export async function sweepExpiredCouponReservations(): Promise<number> {
  const result = await prisma.couponRedemption.updateMany({ where: { status: "RESERVED", expiresAt: { lte: new Date() } }, data: { status: "EXPIRED" } });
  return result.count;
}

// STEP 27 §30 — the non-monetary discountType dispatch: FREE_TRIAL extends
// trial-eligible days (discountValue reinterpreted as day count), CREDIT
// grants a MembershipCredit (discountValue reinterpreted as minor-unit
// amount), FREE_FEATURE grants a time-bound EntitlementOverride for
// coupon.freeFeatureKey. Called once a redemption is REDEEMED (payment
// confirmed), never at validation time.
export type CouponEffect = { kind: "NONE" } | { kind: "TRIAL_DAYS"; days: number } | { kind: "CREDIT"; amountMinor: number; currencyCode: string } | { kind: "FREE_FEATURE"; featureKey: string };

export function resolveCouponEffect(coupon: Pick<Coupon, "discountType" | "discountValue" | "currencyCode" | "freeFeatureKey">): CouponEffect {
  if (coupon.discountType === "FREE_TRIAL") return { kind: "TRIAL_DAYS", days: coupon.discountValue };
  if (coupon.discountType === "CREDIT") return { kind: "CREDIT", amountMinor: coupon.discountValue, currencyCode: coupon.currencyCode ?? "PKR" };
  if (coupon.discountType === "FREE_FEATURE" && coupon.freeFeatureKey) return { kind: "FREE_FEATURE", featureKey: coupon.freeFeatureKey };
  return { kind: "NONE" };
}
