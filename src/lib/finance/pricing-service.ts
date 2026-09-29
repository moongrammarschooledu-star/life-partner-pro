import { prisma } from "@/lib/prisma";
import { addMoney, subtractMoney } from "@/lib/finance/money";
import { computeTax, resolveTaxRule } from "@/lib/finance/tax";
import { resolveCouponForOrder, type ResolveCouponContext } from "@/lib/finance/coupon";
import { evaluatePromotionEligibility } from "@/lib/promotions/eligibility";
import { getBalance } from "@/lib/finance/credits";

// STEP 27 §46 — a thin orchestration layer over already-proven math
// (money.ts/tax.ts) and validation (coupon.ts/eligibility.ts). It never
// reimplements arithmetic; it composes existing pieces in one documented
// order so promotions/credits get a single integration point instead of
// duplicated logic across checkout, subscription-change, and renewal code.
//
// Fixed stacking order (disclosed, not implicit): promotion discount →
// coupon discount → credit application → tax. Tax is always computed on the
// post-discount, pre-credit amount (a credit is treated as a form of
// payment, not a price reduction, so it never changes the taxable base).

export async function getPackagePrice(packageId: string) {
  return prisma.packagePrice.findFirst({ where: { packageId, active: true }, orderBy: { effectiveFrom: "desc" } });
}

export function calculateSubtotal(unitPriceMinor: number, quantity = 1): number {
  let total = 0;
  for (let i = 0; i < quantity; i++) total = addMoney(total, unitPriceMinor);
  return total;
}

export async function validateCurrency(currencyCode: string): Promise<boolean> {
  const currency = await prisma.currency.findUnique({ where: { code: currencyCode } });
  return !!currency?.active;
}

export interface ApplyDiscountParams {
  subtotalMinor: number;
  packageId: string;
  packageType: string;
  profileId: string;
  couponCode?: string;
  promotionId?: string;
  couponContext?: ResolveCouponContext;
}

export interface DiscountResult {
  discountMinor: number;
  couponId?: string;
  couponDiscountMinor: number;
  promotionDiscountMinor: number;
}

export async function applyDiscount(params: ApplyDiscountParams): Promise<DiscountResult> {
  let remaining = params.subtotalMinor;
  let promotionDiscountMinor = 0;

  if (params.promotionId) {
    const eligible = await evaluatePromotionEligibility(params.profileId, params.promotionId, { packageId: params.packageId });
    if (eligible.ok && eligible.discountMinor) {
      promotionDiscountMinor = Math.min(eligible.discountMinor, remaining);
      remaining = subtractMoney(remaining, promotionDiscountMinor);
    }
  }

  let couponDiscountMinor = 0;
  let couponId: string | undefined;
  if (params.couponCode) {
    const result = await resolveCouponForOrder(params.couponCode, params.profileId, params.packageId, remaining, {
      ...params.couponContext,
      subscriptionType: params.couponContext?.subscriptionType ?? params.packageType,
    });
    if (!result.ok) throw new Error(result.reason);
    couponDiscountMinor = result.discountMinor;
    couponId = result.couponId;
  }

  return {
    discountMinor: addMoney(promotionDiscountMinor, couponDiscountMinor),
    couponId,
    couponDiscountMinor,
    promotionDiscountMinor,
  };
}

export async function calculateTax(amountMinor: number, country: string): Promise<{ taxMinor: number; taxRuleFound: boolean }> {
  const taxRule = await resolveTaxRule(country, "package");
  const taxMinor = taxRule ? computeTax(amountMinor, taxRule.ratePercentBasisPoints) : 0;
  return { taxMinor, taxRuleFound: !!taxRule };
}

export async function calculateCredits(profileId: string, amountMinor: number, currencyCode: string): Promise<number> {
  const balance = await getBalance(profileId, currencyCode);
  return Math.min(balance, amountMinor);
}

export interface CalculateTotalParams {
  subtotalMinor: number;
  packageId: string;
  packageType: string;
  profileId: string;
  currencyCode: string;
  country: string;
  couponCode?: string;
  promotionId?: string;
  couponContext?: ResolveCouponContext;
  useAvailableCredits?: boolean;
}

export interface TotalResult {
  subtotalMinor: number;
  discountMinor: number;
  couponId?: string;
  couponDiscountMinor: number;
  promotionDiscountMinor: number;
  taxMinor: number;
  taxRuleFound: boolean;
  creditAppliedMinor: number;
  totalMinor: number; // amount actually charged to the payment provider, after credit
  totalBeforeCreditMinor: number; // subtotal - discount + tax, before credit
}

export async function calculateTotal(params: CalculateTotalParams): Promise<TotalResult> {
  const discount = await applyDiscount({
    subtotalMinor: params.subtotalMinor,
    packageId: params.packageId,
    packageType: params.packageType,
    profileId: params.profileId,
    couponCode: params.couponCode,
    promotionId: params.promotionId,
    couponContext: params.couponContext,
  });

  const taxableAmount = subtractMoney(params.subtotalMinor, discount.discountMinor);
  const { taxMinor, taxRuleFound } = await calculateTax(taxableAmount, params.country);
  const totalBeforeCreditMinor = addMoney(taxableAmount, taxMinor);

  const creditAppliedMinor = params.useAvailableCredits ? await calculateCredits(params.profileId, totalBeforeCreditMinor, params.currencyCode) : 0;
  const totalMinor = subtractMoney(totalBeforeCreditMinor, creditAppliedMinor);

  return {
    subtotalMinor: params.subtotalMinor,
    discountMinor: discount.discountMinor,
    couponId: discount.couponId,
    couponDiscountMinor: discount.couponDiscountMinor,
    promotionDiscountMinor: discount.promotionDiscountMinor,
    taxMinor,
    taxRuleFound,
    creditAppliedMinor,
    totalMinor,
    totalBeforeCreditMinor,
  };
}
