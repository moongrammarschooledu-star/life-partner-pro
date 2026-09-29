import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { notifyEntitlementExpired } from "@/lib/notifications/events";
import type { EntitlementOverrideType } from "@prisma/client";

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
  if (resetPeriod === "MONTHLY" || resetPeriod === "PER_MONTH") {
    return { periodStart: new Date(now.getFullYear(), now.getMonth(), 1), periodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 1) };
  }
  if (resetPeriod === "YEARLY") {
    return { periodStart: new Date(now.getFullYear(), 0, 1), periodEnd: new Date(now.getFullYear() + 1, 0, 1) };
  }
  if (resetPeriod === "PER_WEEK") {
    const day = now.getDay();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
    return { periodStart: start, periodEnd: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7) };
  }
  if (resetPeriod === "PER_DAY") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { periodStart: start, periodEnd: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1) };
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
// row when the guard fails. Kept exactly as-is (package-only, no override
// awareness, no idempotency key) for backward compatibility with existing
// call sites — new call sites should prefer consumeUsageIdempotent below.
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

// ---------------------------------------------------------------------
// STEP 27 §4/§7/§8 — entitlement states, overrides, idempotent usage
// ledger, checkFeatureAccess/refundUsage/resetUsage. Additive: everything
// above stays exactly as it was for existing callers.
// ---------------------------------------------------------------------

export type EntitlementState = "ACTIVE" | "LIMITED" | "EXPIRED" | "SUSPENDED" | "CANCELLED" | "PENDING" | "REVOKED";

export interface FeatureAccessResult {
  allowed: boolean;
  state: EntitlementState;
  remaining: number | null;
  source: "PACKAGE" | "OVERRIDE";
}

type PackageEntitlementLike = { featureKey: string; limitValue: number | null; resetPeriod: string | null };

type EffectiveEntitlement = { revoked: true } | { revoked?: false; limitValue: number | null; resetPeriod: string | null; source: "PACKAGE" | "OVERRIDE" } | null;

// The single place override precedence over package-derived entitlements is
// decided (spec §27's "never allow hidden, hard-to-reason-about overrides" —
// this function is the one thing to read to understand the rule):
//   1. An active, unexpired, unrevoked REVOKE override always wins, even
//      over a paid package.
//   2. An active GRANT override grants access even with no subscription at
//      all, using its own limitValue (or unlimited if null).
//   3. An active LIMIT_ADJUST override substitutes its limitValue onto
//      whatever the package would otherwise grant (falls through to the
//      package lookup for the resetPeriod).
//   4. Otherwise, resolve against the caller's active Subscription — its
//      locked PackageVersion.featuresSnapshot when set, else the package's
//      live, current entitlements.
async function resolveEffectiveEntitlement(profileId: string, featureKey: string): Promise<EffectiveEntitlement> {
  const now = new Date();
  const override = await prisma.entitlementOverride.findFirst({
    where: { profileId, featureKey, expiresAt: { gt: now }, revokedAt: null },
    orderBy: { createdAt: "desc" },
  });

  if (override?.overrideType === "REVOKE") return { revoked: true };
  if (override?.overrideType === "GRANT") return { limitValue: override.limitValue, resetPeriod: null, source: "OVERRIDE" };

  const subscription = await prisma.subscription.findFirst({
    where: { profileId, status: { in: ["ACTIVE", "TRIAL", "GRACE_PERIOD"] } },
    include: { package: { include: { entitlements: true } }, packageVersion: true },
  });
  if (!subscription) return null;

  const entitlements: PackageEntitlementLike[] = subscription.packageVersionId && subscription.packageVersion
    ? ((subscription.packageVersion.featuresSnapshot as unknown as PackageEntitlementLike[]) ?? [])
    : subscription.package.entitlements;
  const entitlement = entitlements.find((e) => e.featureKey === featureKey);
  if (!entitlement) return null;

  const limitValue = override?.overrideType === "LIMIT_ADJUST" ? override.limitValue : entitlement.limitValue;
  return { limitValue, resetPeriod: entitlement.resetPeriod, source: "PACKAGE" };
}

// The recommended entry point for all NEW callers (premium-action routes,
// matching gates, AI gates) — combines overrides + package entitlements +
// remaining usage into one answer. hasEntitlement/getRemainingUsage/
// consumeUsage above stay as the package-only primitives this is built on.
export async function checkFeatureAccess(profileId: string, featureKey: string): Promise<FeatureAccessResult> {
  const effective = await resolveEffectiveEntitlement(profileId, featureKey);

  if (effective && effective.revoked) {
    return { allowed: false, state: "REVOKED", remaining: 0, source: "OVERRIDE" };
  }
  if (!effective) {
    const latestSubscription = await prisma.subscription.findFirst({ where: { profileId }, orderBy: { createdAt: "desc" } });
    const state: EntitlementState = latestSubscription && (latestSubscription.status === "PENDING" || latestSubscription.status === "PAYMENT_FAILED") ? "PENDING" : "EXPIRED";
    return { allowed: false, state, remaining: 0, source: "PACKAGE" };
  }
  if (effective.limitValue == null) return { allowed: true, state: "ACTIVE", remaining: null, source: effective.source };

  const { periodStart } = currentPeriodBounds(effective.resetPeriod);
  const usage = await prisma.featureUsage.findUnique({ where: { profileId_featureKey_periodStart: { profileId, featureKey, periodStart } } });
  const remaining = Math.max(0, effective.limitValue - (usage?.usageCount ?? 0));
  return { allowed: remaining > 0, state: remaining > 0 ? "ACTIVE" : "LIMITED", remaining, source: effective.source };
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
}

export interface ConsumeUsageMeta {
  subscriptionId?: string;
  referenceType?: string;
  referenceId?: string;
}

// STEP 27 §11 — idempotent consumption: the SAME requestId never consumes
// usage twice, even on client retry. Override-aware (unlike the legacy
// consumeUsage above), via resolveEffectiveEntitlement.
export async function consumeUsageIdempotent(profileId: string, featureKey: string, requestId: string, meta: ConsumeUsageMeta = {}): Promise<boolean> {
  const effective = await resolveEffectiveEntitlement(profileId, featureKey);
  if (!effective || effective.revoked) return false;

  const { periodStart, periodEnd } = currentPeriodBounds(effective.resetPeriod);

  return prisma.$transaction(async (tx) => {
    try {
      await tx.featureUsageLedger.create({
        data: { profileId, featureKey, subscriptionId: meta.subscriptionId, action: "CONSUMED", quantity: 1, requestId, referenceType: meta.referenceType, referenceId: meta.referenceId },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) return true; // already consumed under this requestId — no-op, not a failure
      throw error;
    }

    if (effective.limitValue == null) {
      await tx.featureUsage.upsert({
        where: { profileId_featureKey_periodStart: { profileId, featureKey, periodStart } },
        update: { usageCount: { increment: 1 } },
        create: { profileId, featureKey, periodStart, periodEnd, usageCount: 1 },
      });
      return true;
    }

    const existing = await tx.featureUsage.findUnique({ where: { profileId_featureKey_periodStart: { profileId, featureKey, periodStart } } });
    if (!existing) {
      await tx.featureUsage.create({ data: { profileId, featureKey, periodStart, periodEnd, usageCount: 1 } });
      return true;
    }
    const result = await tx.featureUsage.updateMany({
      where: { id: existing.id, usageCount: { lt: effective.limitValue } },
      data: { usageCount: { increment: 1 } },
    });
    return result.count > 0;
  });
}

// STEP 27 §12 — reverses a specific idempotent consumption if the downstream
// operation it gated then failed. Idempotent itself: refunding the same
// requestId twice only decrements the counter once.
export async function refundUsage(profileId: string, featureKey: string, requestId: string): Promise<boolean> {
  const original = await prisma.featureUsageLedger.findUnique({ where: { featureKey_requestId: { featureKey, requestId } } });
  if (!original || original.action !== "CONSUMED") return false;

  const alreadyRefunded = await prisma.featureUsageLedger.findFirst({ where: { reversedLedgerId: original.id } });
  if (alreadyRefunded) return true;

  const effective = await resolveEffectiveEntitlement(profileId, featureKey);
  const resetPeriod = effective && !effective.revoked ? effective.resetPeriod : null;
  const { periodStart } = currentPeriodBounds(resetPeriod);

  await prisma.$transaction(async (tx) => {
    const usage = await tx.featureUsage.findUnique({ where: { profileId_featureKey_periodStart: { profileId, featureKey, periodStart } } });
    if (usage) {
      await tx.featureUsage.update({ where: { id: usage.id }, data: { usageCount: Math.max(0, usage.usageCount - original.quantity) } });
    }
    await tx.featureUsageLedger.create({
      data: { profileId, featureKey, action: "REFUNDED", quantity: original.quantity, requestId: `refund:${requestId}:${Date.now()}`, reversedLedgerId: original.id },
    });
  });
  await writeAudit({ action: "USAGE_REFUNDED", targetProfileId: profileId, meta: { featureKey, requestId } });
  return true;
}

// STEP 27 §9 — admin-only, zeroes the currently-active period's counter.
export async function resetUsage(profileId: string, featureKey: string, reason: string, actorId: string): Promise<number> {
  const now = new Date();
  const result = await prisma.featureUsage.updateMany({ where: { profileId, featureKey, periodEnd: { gt: now } }, data: { usageCount: 0 } });
  await prisma.featureUsageLedger.create({
    data: { profileId, featureKey, action: "ADMIN_RESET", quantity: 0, requestId: `reset:${profileId}:${featureKey}:${now.getTime()}`, referenceType: "ADMIN", referenceId: actorId },
  });
  await writeAudit({ action: "USAGE_RESET", adminId: actorId, targetProfileId: profileId, meta: { featureKey, reason } });
  return result.count;
}

export interface GrantOverrideInput {
  profileId: string;
  featureKey: string;
  overrideType: EntitlementOverrideType;
  limitValue?: number;
  reason: string;
  expiresAt: Date;
  approvedById?: string;
}

// Plain DB mutation — the maker-checker gate (APPROVAL_CATALOG's
// SUBSCRIPTION_OVERRIDE entry) is enforced by the calling admin API route
// via enforceApprovalGate, exactly like every other STEP 19-gated action in
// this codebase (see src/lib/approvals/gate.ts's usage comment) — never
// duplicated here. actorId is null for a system-granted override (e.g. a
// referral reward's dispatch) — there is no real AdminUser actor for that.
export async function grantOverride(actorId: string | null, input: GrantOverrideInput) {
  const created = await prisma.entitlementOverride.create({
    data: {
      profileId: input.profileId,
      featureKey: input.featureKey,
      overrideType: input.overrideType,
      limitValue: input.limitValue,
      reason: input.reason,
      createdById: actorId ?? undefined,
      createdBySystem: actorId == null,
      approvedById: input.approvedById,
      expiresAt: input.expiresAt,
    },
  });
  await writeAudit({ action: "ENTITLEMENT_OVERRIDE", adminId: actorId ?? undefined, targetProfileId: input.profileId, meta: { featureKey: input.featureKey, overrideType: input.overrideType, expiresAt: input.expiresAt, system: actorId == null } });
  return created;
}

export async function revokeOverrideGrant(actorId: string, overrideId: string) {
  const updated = await prisma.entitlementOverride.update({ where: { id: overrideId }, data: { revokedAt: new Date() } });
  await writeAudit({ action: "ENTITLEMENT_REVOKED", adminId: actorId, targetProfileId: updated.profileId, meta: { featureKey: updated.featureKey, overrideId } });
  return updated;
}

export async function listActiveOverrides(profileId: string) {
  return prisma.entitlementOverride.findMany({ where: { profileId, expiresAt: { gt: new Date() }, revokedAt: null }, orderBy: { createdAt: "desc" } });
}

// STEP 27 §21 tick — a naturally-expired override needs no explicit revoke
// to become inert (resolveEffectiveEntitlement already filters
// expiresAt > now), but this sweep sends the one-time ENTITLEMENT_EXPIRED
// courtesy notice and marks the row processed (via revokedAt, reused here
// as "no longer active" rather than "explicitly revoked by an admin" — the
// distinction is visible in the audit trail either way) so it's found once.
export async function sweepExpiredOverrides(): Promise<number> {
  const now = new Date();
  const expired = await prisma.entitlementOverride.findMany({ where: { expiresAt: { lte: now }, revokedAt: null }, select: { id: true, profileId: true } });
  for (const o of expired) {
    await prisma.entitlementOverride.update({ where: { id: o.id }, data: { revokedAt: now } });
  }
  const uniqueProfiles = [...new Set(expired.map((o) => o.profileId))];
  for (const profileId of uniqueProfiles) await notifyEntitlementExpired(profileId).catch(() => undefined);
  return uniqueProfiles.length;
}
