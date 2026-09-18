import { prisma } from "@/lib/prisma";

// Spec §38/§39/§40 — never trust frontend package state; every premium
// action checks server-side. featureKey is free text, not an enum, so a
// new feature never requires a schema/code change (spec §8).
export async function getUserEntitlements(profileId: string) {
  const activeSubscription = await prisma.subscription.findFirst({
    where: { profileId, status: { in: ["ACTIVE", "TRIAL", "GRACE_PERIOD"] } },
    include: { package: { include: { entitlements: true } } },
  });
  return activeSubscription?.package.entitlements ?? [];
}

export async function hasEntitlement(profileId: string, featureKey: string): Promise<boolean> {
  const entitlements = await getUserEntitlements(profileId);
  return entitlements.some((e) => e.featureKey === featureKey);
}

function currentPeriodBounds(resetPeriod: string | null): { periodStart: Date; periodEnd: Date } {
  const now = new Date();
  if (resetPeriod === "MONTHLY") {
    return { periodStart: new Date(now.getFullYear(), now.getMonth(), 1), periodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 1) };
  }
  if (resetPeriod === "YEARLY") {
    return { periodStart: new Date(now.getFullYear(), 0, 1), periodEnd: new Date(now.getFullYear() + 1, 0, 1) };
  }
  // Lifetime (for the subscription term) — a wide, effectively-unbounded window.
  return { periodStart: new Date(2000, 0, 1), periodEnd: new Date(2100, 0, 1) };
}

export async function getRemainingUsage(profileId: string, featureKey: string): Promise<number | null> {
  const entitlements = await getUserEntitlements(profileId);
  const entitlement = entitlements.find((e) => e.featureKey === featureKey);
  if (!entitlement) return 0; // no entitlement at all
  if (entitlement.limitValue == null) return null; // unlimited

  const { periodStart } = currentPeriodBounds(entitlement.resetPeriod);
  const usage = await prisma.featureUsage.findUnique({ where: { profileId_featureKey_periodStart: { profileId, featureKey, periodStart } } });
  return Math.max(0, entitlement.limitValue - (usage?.usageCount ?? 0));
}

// Atomic, transactional usage consumption (spec §40) — the WHERE-guarded
// updateMany is what prevents two simultaneous requests from both
// succeeding past the limit; only one of two concurrent calls can win the
// row when the guard fails.
export async function consumeUsage(profileId: string, featureKey: string): Promise<boolean> {
  const entitlements = await getUserEntitlements(profileId);
  const entitlement = entitlements.find((e) => e.featureKey === featureKey);
  if (!entitlement) return false;

  if (entitlement.limitValue == null) {
    // Unlimited — still track usage for reporting, no guard needed.
    const { periodStart, periodEnd } = currentPeriodBounds(entitlement.resetPeriod);
    await prisma.featureUsage.upsert({
      where: { profileId_featureKey_periodStart: { profileId, featureKey, periodStart } },
      update: { usageCount: { increment: 1 } },
      create: { profileId, featureKey, periodStart, periodEnd, usageCount: 1 },
    });
    return true;
  }

  const { periodStart, periodEnd } = currentPeriodBounds(entitlement.resetPeriod);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.featureUsage.findUnique({ where: { profileId_featureKey_periodStart: { profileId, featureKey, periodStart } } });
    if (!existing) {
      await tx.featureUsage.create({ data: { profileId, featureKey, periodStart, periodEnd, usageCount: 1 } });
      return true;
    }
    const result = await tx.featureUsage.updateMany({
      where: { id: existing.id, usageCount: { lt: entitlement.limitValue! } },
      data: { usageCount: { increment: 1 } },
    });
    return result.count > 0;
  });
}
