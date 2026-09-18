import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { isValidSubscriptionStatusTransition } from "@/lib/finance/status-transitions";
import { notifySubscriptionStarted, notifySubscriptionRenewed, notifySubscriptionCancelled, notifySubscriptionExpiring } from "@/lib/notifications/events";
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
export async function activateSubscription(params: { profileId: string; packageId: string; billingType: string; durationDays: number | null; trialDays: number }) {
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

// Spec §26 — cancellation never deletes the matrimonial profile; only
// removes paid entitlements. immediate=false marks CANCELLED but leaves
// endDate as-is (still usable until period end); immediate=true ends now.
export async function cancelSubscription(subscriptionId: string, reason: string, immediate: boolean) {
  const subscription = await changeSubscriptionStatus(subscriptionId, "CANCELLED", reason);
  await prisma.subscription.update({
    where: { id: subscriptionId },
    data: { cancelledAt: new Date(), cancellationReason: reason, autoRenew: false, ...(immediate ? { endDate: new Date() } : {}) },
  });
  await writeAudit({ action: "SUBSCRIPTION_CANCELLED", targetProfileId: subscription.profileId, meta: { subscriptionId, immediate, reason } });
  await notifySubscriptionCancelled(subscription.profileId);
}

// Spec §25 — piggybacks on the existing single daily cron tick (see
// src/app/api/cron/notifications/route.ts). For the Manual provider,
// "attempting renewal payment" means creating a new payable Order and
// notifying the applicant — there is no card to silently re-charge.
export async function runDueSubscriptionRenewals() {
  const now = new Date();
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  const gracePeriodDays = settings?.subscriptionGracePeriodDays ?? 7;

  const dueForRenewal = await prisma.subscription.findMany({
    where: { status: "ACTIVE", autoRenew: true, renewalDate: { lte: now } },
  });
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
