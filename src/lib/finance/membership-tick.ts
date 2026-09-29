import { sweepExpiredCouponReservations } from "@/lib/finance/coupon";
import { sweepExpiredOverrides } from "@/lib/finance/entitlements";
import { expireCredits } from "@/lib/finance/credits";
import { seedFeatureCatalog } from "@/lib/finance/catalog";

// The STEP 27 part of the single daily tick — mirrors src/lib/documents/tick.ts's
// shape exactly. Subscription renewals/trial-ending/pending-package-change
// already run inside runDueSubscriptionRenewals (src/lib/finance/subscription.ts),
// already wired into the tick before this STEP.

export interface MembershipTickResult {
  couponReservationsExpired: number | null;
  overridesExpired: number | null;
  creditsExpired: number | null;
  errors: string[];
}

async function step<T>(name: string, errors: string[], fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    errors.push(`${name}: ${error instanceof Error ? error.message.slice(0, 160) : "failed"}`);
    return null;
  }
}

export async function runMembershipTick(): Promise<MembershipTickResult> {
  const errors: string[] = [];
  await step("seed-feature-catalog", errors, seedFeatureCatalog); // idempotent — cheap insurance if a fresh env never ran it
  const couponReservationsExpired = await step("coupon-reservations", errors, () => sweepExpiredCouponReservations());
  const overridesExpired = await step("entitlement-overrides", errors, () => sweepExpiredOverrides());
  const creditsExpired = await step("credits", errors, () => expireCredits());
  return { couponReservationsExpired, overridesExpired, creditsExpired, errors };
}
