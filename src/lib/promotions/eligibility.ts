import { prisma } from "@/lib/prisma";
import { getPaymentFeatureFlags } from "@/lib/finance/rollout";

// STEP 27 §45 — server-validated promotion eligibility only; a promotion is
// NEVER applied because the client claims it applies. Mirrors coupon.ts's
// pure-validation-plus-DB-wrapper split.

export interface PromotionEligibilityContext {
  packageId: string;
}

export type PromotionEligibilityResult = { ok: true; discountMinor: number } | { ok: false; reason: string };

export async function evaluatePromotionEligibility(profileId: string, promotionId: string, context: PromotionEligibilityContext): Promise<PromotionEligibilityResult> {
  // STEP 27 §61 — kill switch: existing applied promotions are untouched;
  // only NEW eligibility grants are paused while disabled.
  if (!(await getPaymentFeatureFlags()).promotionsEnabled) return { ok: false, reason: "Promotions are temporarily unavailable." };
  const promotion = await prisma.promotion.findUnique({ where: { id: promotionId }, include: { rules: true, packages: true } });
  if (!promotion) return { ok: false, reason: "Unknown promotion." };
  if (promotion.status !== "ACTIVE") return { ok: false, reason: "This promotion is not currently active." };

  const now = new Date();
  if (promotion.startDate && now < promotion.startDate) return { ok: false, reason: "This promotion has not started yet." };
  if (promotion.endDate && now > promotion.endDate) return { ok: false, reason: "This promotion has ended." };

  if (promotion.packages.length > 0 && !promotion.packages.some((p) => p.packageId === context.packageId)) {
    return { ok: false, reason: "This promotion does not apply to the selected package." };
  }

  for (const rule of promotion.rules) {
    const result = await evaluateRule(profileId, rule.ruleType, rule.ruleConfig as Record<string, unknown>, context);
    if (!result) return { ok: false, reason: "You are not eligible for this promotion." };
  }

  if (promotion.promotionType !== "PACKAGE_DISCOUNT") return { ok: true, discountMinor: 0 };
  const config = promotion.config as { discountType?: "PERCENTAGE" | "FIXED_AMOUNT"; discountValue?: number; maxDiscountMinor?: number };
  if (!config.discountValue) return { ok: true, discountMinor: 0 };

  return { ok: true, discountMinor: config.discountValue };
}

async function evaluateRule(profileId: string, ruleType: string, config: Record<string, unknown>, context: PromotionEligibilityContext): Promise<boolean> {
  if (ruleType === "FIRST_TIME_USER") {
    const priorPaidOrder = await prisma.order.findFirst({ where: { profileId, status: { in: ["PAID", "COMPLETED"] } } });
    return !priorPaidOrder;
  }
  if (ruleType === "MIN_ACCOUNT_AGE_DAYS") {
    const profile = await prisma.profile.findUnique({ where: { id: profileId }, select: { createdAt: true } });
    if (!profile) return false;
    const minDays = Number(config.minDays ?? 0);
    const ageDays = (Date.now() - profile.createdAt.getTime()) / 86_400_000;
    return ageDays >= minDays;
  }
  if (ruleType === "SUBSCRIPTION_TYPE") {
    const pkg = await prisma.package.findUnique({ where: { id: context.packageId }, select: { packageType: true } });
    const allowed = (config.allowed as string[] | undefined) ?? [];
    return !!pkg && allowed.includes(pkg.packageType);
  }
  // COUNTRY/CURRENCY rules need caller-supplied context this function
  // doesn't have direct access to today — treated as "no restriction
  // enforceable here" is unsafe, so unknown/unimplemented rule types fail
  // closed rather than silently passing.
  return false;
}
