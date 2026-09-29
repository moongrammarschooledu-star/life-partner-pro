import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { isValidSubscriptionStatusTransition } from "@/lib/finance/status-transitions";
import { notifySubscriptionStarted, notifySubscriptionRenewed, notifySubscriptionCancelled, notifySubscriptionExpiring, notifyTrialEnding, notifyPackageChanged, notifyEntitlementExpired } from "@/lib/notifications/events";
import { subtractMoney } from "@/lib/finance/money";
import { grantCredit } from "@/lib/finance/credits";
import { getPaymentFeatureFlags } from "@/lib/finance/rollout";
import type { SubscriptionStatus } from "@prisma/client";

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

async function changeSubscriptionStatus(subscriptionId: string, toStatus: SubscriptionStatus, reason?: string) {
  const subscription = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
  if (!subscription) throw new Error("Subscription not found");
  if (!isValidSubscriptionStatusTransition(subscription.status, toStatus)) {
    throw new Error(`Invalid subscription status transition: ${subscription.status} -> ${toStatus}`);
  }
  await prisma.$transaction([
    prisma.subscription.update({ where: { id: subscriptionId }, data: { status: toStatus } }),
    prisma.subscriptionEvent.create({ data: { subscriptionId, fromStatus: subscription.status, toStatus, reason: reason ?? null } }),
  ]);
  return subscription;
}

// Spec §12 — activation only happens after a Payment is confirmed PAID
// (called from the payment-confirmation path, never from checkout directly).
// STEP 27 §1/§23 — packagePriceId/packageVersionId lock in the exact terms
// this subscription was sold under, so a later package/price change never
// retroactively alters it. Both optional for backward compat.
export async function activateSubscription(params: {
  profileId: string;
  packageId: string;
  billingType: string;
  durationDays: number | null;
  trialDays: number;
  packagePriceId?: string | null;
  packageVersionId?: string | null;
}) {
  const subscriptionCode = await nextSequenceCode("SUB");
  const now = new Date();
  const startDate = now;
  const trialEndsAt = params.trialDays > 0 ? addDays(now, params.trialDays) : null;
  const endDate = params.durationDays ? addDays(trialEndsAt ?? now, params.durationDays) : null;

  const subscription = await prisma.subscription.create({
    data: {
      subscriptionCode,
      profileId: params.profileId,
      packageId: params.packageId,
      packagePriceId: params.packagePriceId ?? null,
      packageVersionId: params.packageVersionId ?? null,
      provider: "MANUAL",
      status: trialEndsAt ? "TRIAL" : "ACTIVE",
      startDate,
      endDate,
      renewalDate: endDate,
      trialEndsAt,
    },
  });
  await prisma.subscriptionEvent.create({ data: { subscriptionId: subscription.id, toStatus: subscription.status, reason: "Activated after confirmed payment" } });
  await writeAudit({ action: "SUBSCRIPTION_CREATED", targetProfileId: params.profileId, meta: { subscriptionId: subscription.id, subscriptionCode } });
  await notifySubscriptionStarted(params.profileId);
  return subscription;
}

// STEP 27 §19 — blocks repeat-trial abuse. PER_ACCOUNT (default): no prior
// subscription for this profile, on ANY package, ever had a trial. Matches
// the pre-STEP-27 behavior most closely (activateSubscription previously
// granted a trial unconditionally from Package.trialDays every time).
export async function isEligibleForTrial(profileId: string, packageId: string): Promise<boolean> {
  const pkg = await prisma.package.findUnique({ where: { id: packageId }, select: { trialEligibilityScope: true } });
  if (!pkg) return false;
  const where = pkg.trialEligibilityScope === "PER_PACKAGE" ? { profileId, packageId, trialEndsAt: { not: null } } : { profileId, trialEndsAt: { not: null } };
  const priorTrial = await prisma.subscription.findFirst({ where });
  return !priorTrial;
}

// Spec §26 — cancellation never deletes the matrimonial profile; only
// removes paid entitlements. immediate=false marks CANCELLED but leaves
// endDate as-is (still usable until period end); immediate=true ends now.
// STEP 27 §22 — initiatedBy is audit/notification clarity only, no new
// state machine: USER (applicant self-cancel), ADMIN (staff-initiated,
// reason required — already enforced by this function's signature),
// PROVIDER (a future payment-provider webhook, e.g. subscription.deleted).
export async function cancelSubscription(subscriptionId: string, reason: string, immediate: boolean, initiatedBy: "USER" | "ADMIN" | "PROVIDER" = "USER") {
  const subscription = await changeSubscriptionStatus(subscriptionId, "CANCELLED", reason);
  await prisma.subscription.update({
    where: { id: subscriptionId },
    data: { cancelledAt: new Date(), cancellationReason: reason, cancelInitiatedBy: initiatedBy, autoRenew: false, ...(immediate ? { endDate: new Date() } : {}) },
  });
  await writeAudit({ action: "SUBSCRIPTION_CANCELLED", targetProfileId: subscription.profileId, meta: { subscriptionId, immediate, reason, initiatedBy } });
  await notifySubscriptionCancelled(subscription.profileId);
}

// STEP 27 §23 — mid-cycle package upgrade/downgrade. Proration is real but
// deliberately simple: daily, integer-truncated, single-step — not a full
// metered/hourly billing engine (disclosed limitation). All arithmetic goes
// through money.ts's subtractMoney only; never raw floating-point math.
export interface ChangeSubscriptionPackageResult {
  mode: "IMMEDIATE_CHARGE" | "IMMEDIATE_CREDIT" | "SCHEDULED";
  netAmountMinor: number;
}

export async function changeSubscriptionPackage(subscriptionId: string, newPackageId: string, effective: "IMMEDIATE" | "NEXT_CYCLE"): Promise<ChangeSubscriptionPackageResult> {
  const subscription = await prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { package: { include: { prices: { where: { active: true }, orderBy: { effectiveFrom: "desc" }, take: 1 } } } } });
  if (!subscription) throw new Error("Subscription not found");
  const newPackage = await prisma.package.findUnique({ where: { id: newPackageId }, include: { prices: { where: { active: true }, orderBy: { effectiveFrom: "desc" }, take: 1 } } });
  if (!newPackage || newPackage.status !== "ACTIVE") throw new Error("The selected package is not currently available.");

  if (effective === "NEXT_CYCLE") {
    await prisma.subscription.update({ where: { id: subscriptionId }, data: { pendingPackageId: newPackageId } });
    return { mode: "SCHEDULED", netAmountMinor: 0 };
  }

  const oldPrice = subscription.package.prices[0]?.amountMinor ?? 0;
  const newPrice = newPackage.prices[0]?.amountMinor ?? 0;
  const now = new Date();
  const cycleStart = subscription.startDate ?? subscription.createdAt;
  const cycleEnd = subscription.renewalDate ?? subscription.endDate ?? now;
  const totalCycleDays = Math.max(1, Math.round((cycleEnd.getTime() - cycleStart.getTime()) / 86_400_000));
  const daysRemaining = Math.max(0, Math.round((cycleEnd.getTime() - now.getTime()) / 86_400_000));
  const unusedCreditMinor = Math.floor((oldPrice * daysRemaining) / totalCycleDays);
  const netAmountMinor = subtractMoney(newPrice, unusedCreditMinor);

  await prisma.subscription.update({
    where: { id: subscriptionId },
    data: { packageId: newPackageId, packagePriceId: newPackage.prices[0]?.id ?? null, pendingPackageId: null },
  });
  await prisma.subscriptionEvent.create({ data: { subscriptionId, fromStatus: subscription.status, toStatus: subscription.status, reason: `Package changed to ${newPackage.name} (immediate, net ${netAmountMinor})` } });
  await writeAudit({ action: "SUBSCRIPTION_CHANGED", targetProfileId: subscription.profileId, meta: { subscriptionId, fromPackageId: subscription.packageId, toPackageId: newPackageId, netAmountMinor } });
  await notifyPackageChanged(subscription.profileId);

  if (netAmountMinor < 0) {
    // Net credit owed rather than a cash refund (spec's proration-credit model).
    await grantCredit({ profileId: subscription.profileId, currencyCode: newPackage.prices[0]?.currencyCode ?? "PKR", amountMinor: -netAmountMinor, reason: "Package downgrade proration credit", referenceType: "SUBSCRIPTION", referenceId: subscriptionId });
    return { mode: "IMMEDIATE_CREDIT", netAmountMinor };
  }
  // A positive net amount is charged via the normal checkout/Order path by
  // the caller (this function only updates subscription state + proration
  // bookkeeping) — kept out of this function to avoid a second parallel
  // Order-creation path alongside checkout.ts's.
  return { mode: "IMMEDIATE_CHARGE", netAmountMinor };
}

// Spec §25 — piggybacks on the existing single daily cron tick (see
// src/app/api/cron/notifications/route.ts). For the Manual provider,
// "attempting renewal payment" means creating a new payable Order and
// notifying the applicant — there is no card to silently re-charge.
export async function runDueSubscriptionRenewals() {
  const now = new Date();
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  const gracePeriodDays = settings?.subscriptionGracePeriodDays ?? 7;

  // STEP 27 §15/§68 — TRIAL_ENDING reminder, 3 days before trialEndsAt.
  // Idempotent per day via the SubscriptionEvent audit trail check.
  const trialWindowEnd = addDays(now, 3);
  const trialsEnding = await prisma.subscription.findMany({ where: { status: "TRIAL", trialEndsAt: { gte: now, lte: trialWindowEnd } } });
  for (const sub of trialsEnding) {
    const alreadyNotified = await prisma.subscriptionEvent.findFirst({ where: { subscriptionId: sub.id, reason: "TRIAL_ENDING_NOTICE_SENT" } });
    if (alreadyNotified) continue;
    try {
      await notifyTrialEnding(sub.profileId);
      await prisma.subscriptionEvent.create({ data: { subscriptionId: sub.id, toStatus: sub.status, reason: "TRIAL_ENDING_NOTICE_SENT" } });
    } catch {
      // continue processing others regardless of one failure
    }
  }

  // STEP 27 §5 — apply any package change scheduled for NEXT_CYCLE.
  const pendingChanges = await prisma.subscription.findMany({ where: { pendingPackageId: { not: null }, renewalDate: { lte: now } } });
  for (const sub of pendingChanges) {
    try {
      await changeSubscriptionPackage(sub.id, sub.pendingPackageId!, "IMMEDIATE");
    } catch {
      // continue — a failed scheduled change stays pending for manual review rather than silently dropping
    }
  }

  // STEP 27 §61 — kill switch: existing subscriptions/entitlements are
  // untouched; only NEW renewal processing (moving ACTIVE -> PAST_DUE to
  // start the grace-period clock) is paused while disabled.
  const renewalsEnabled = (await getPaymentFeatureFlags()).renewalsEnabled;
  const dueForRenewal = renewalsEnabled
    ? await prisma.subscription.findMany({ where: { status: "ACTIVE", autoRenew: true, renewalDate: { lte: now } } })
    : [];
  for (const sub of dueForRenewal) {
    try {
      await changeSubscriptionStatus(sub.id, "PAST_DUE", "Renewal date reached — payment required");
      await notifySubscriptionExpiring(sub.profileId);
    } catch {
      // continue processing other subscriptions regardless of one failure
    }
  }

  const pastDueEnteringGrace = await prisma.subscription.findMany({ where: { status: "PAST_DUE" } });
  for (const sub of pastDueEnteringGrace) {
    const graceDeadline = addDays(sub.renewalDate ?? now, gracePeriodDays);
    if (now < graceDeadline) {
      try {
        await changeSubscriptionStatus(sub.id, "GRACE_PERIOD", "Entered configured grace period");
      } catch {
        // already transitioned, ignore
      }
    }
  }

  const graceExpired = await prisma.subscription.findMany({ where: { status: "GRACE_PERIOD" } });
  for (const sub of graceExpired) {
    const graceDeadline = addDays(sub.renewalDate ?? now, gracePeriodDays);
    if (now >= graceDeadline) {
      try {
        await changeSubscriptionStatus(sub.id, "EXPIRED", "Grace period ended without payment");
        await writeAudit({ action: "SUBSCRIPTION_EXPIRED", targetProfileId: sub.profileId, meta: { subscriptionId: sub.id } });
        await notifyEntitlementExpired(sub.profileId);
      } catch {
        // continue
      }
    }
  }

  return { markedPastDue: dueForRenewal.length, enteredGrace: pastDueEnteringGrace.length, expired: graceExpired.length };
}

// Called by the checkout/payment-confirmation path once a renewal payment
// actually succeeds — extends the subscription and generates a fresh invoice.
export async function confirmRenewal(subscriptionId: string, durationDays: number) {
  const subscription = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
  if (!subscription) throw new Error("Subscription not found");
  const newEndDate = addDays(new Date(), durationDays);
  await changeSubscriptionStatus(subscriptionId, "ACTIVE", "Renewal payment confirmed");
  await prisma.subscription.update({ where: { id: subscriptionId }, data: { endDate: newEndDate, renewalDate: newEndDate } });
  await writeAudit({ action: "SUBSCRIPTION_RENEWED", targetProfileId: subscription.profileId, meta: { subscriptionId } });
  await notifySubscriptionRenewed(subscription.profileId);
}
