import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { nextCaseNumber } from "@/lib/case-code";
import { computeSlaDueDates } from "@/lib/case-sla";
import { isValidRolloutTransition } from "@/lib/finance/status-transitions";
import { getProvider } from "@/lib/finance/providers/registry";
import { isEmergencyDisabled } from "@/lib/ops/system-control";
import { createFromEvent } from "@/lib/workflow/engine";
import type { PaymentRolloutStage, CaseCategory } from "@prisma/client";

// Payment Rollout Phases (STEP 14 add-on §63-86). A single global stage on
// AppSettings gates *new* checkout sessions only — existing subscriptions,
// invoices, and refund processing are never affected by any of this (spec
// §70). "Disable Payments" (the kill switch) is not a separate mechanism;
// it is just the universal any-stage -> DISABLED transition, so it goes
// through the exact same isValidRolloutTransition() guard as every other
// stage change (see status-transitions.ts).

export class PaymentsUnavailableError extends Error {}

const NEUTRAL_UNAVAILABLE_MESSAGE = "Online payments are temporarily unavailable. Please try again later.";

export interface PaymentFeatureFlags {
  paymentsEnabled: boolean;
  checkoutEnabled: boolean;
  subscriptionsEnabled: boolean;
  refundsEnabled: boolean;
  manualPaymentEnabled: boolean;
  betaEnabled: boolean;
  publicCheckoutEnabled: boolean;
  providerWebhooksEnabled: boolean;
}

export async function getPaymentFeatureFlags(): Promise<PaymentFeatureFlags & { rolloutStage: PaymentRolloutStage }> {
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  return {
    rolloutStage: settings?.paymentRolloutStage ?? "DISABLED",
    paymentsEnabled: settings?.paymentsEnabled ?? false,
    checkoutEnabled: settings?.checkoutEnabled ?? false,
    subscriptionsEnabled: settings?.subscriptionsEnabled ?? false,
    refundsEnabled: settings?.refundsEnabled ?? true,
    manualPaymentEnabled: settings?.manualPaymentEnabled ?? true,
    betaEnabled: settings?.betaEnabled ?? false,
    publicCheckoutEnabled: settings?.publicCheckoutEnabled ?? false,
    providerWebhooksEnabled: settings?.providerWebhooksEnabled ?? true,
  };
}

// Deterministic bucketing (spec §68) — the same profile always lands in the
// same bucket, so eligibility never flickers between requests. No floats,
// no per-request randomness.
export function hashToPercentBucket(profileId: string): number {
  const hash = crypto.createHash("sha256").update(profileId).digest();
  const n = hash.readUInt32BE(0);
  return n % 100; // 0-99
}

interface BetaEligibilityConfig {
  betaPercentage: number;
  allowedProfileIds: string[] | null;
  allowedCountries: string[] | null;
  allowedPackageIds: string[] | null;
}

// An empty array on any axis means "no restriction on that axis" (same as
// null) — an admin clears a restriction by saving [], never by writing a
// raw JSON null, matching this codebase's established Json-field convention
// (see e.g. Coupon.applicablePackageIds).
export function isEligibleForPaymentBeta(
  profile: { id: string; country: string },
  packageId: string | null,
  config: BetaEligibilityConfig
): boolean {
  if (config.allowedProfileIds?.length && config.allowedProfileIds.includes(profile.id)) return true;
  if (config.allowedCountries?.length && !config.allowedCountries.includes(profile.country)) return false;
  if (config.allowedPackageIds?.length && packageId && !config.allowedPackageIds.includes(packageId)) return false;
  return hashToPercentBucket(profile.id) < config.betaPercentage;
}

function asStringArray(value: unknown): string[] | null {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : null;
}

// Real, but honestly scoped to what can actually go wrong today (see plan
// decision 6). Manual has no environment/credential distinction of its own,
// so this is a documented no-op for it; it becomes a live guard the moment
// a real gateway (e.g. STRIPE) is configured.
export function validatePaymentEnvironmentSafety(activeProvider: string, rolloutStage: PaymentRolloutStage): { ok: boolean; detail: string } {
  if (activeProvider === "MANUAL") {
    return { ok: true, detail: "Manual/Bank Transfer has no external environment or credentials to validate." };
  }
  const paymentEnvironment = process.env.PAYMENT_ENVIRONMENT === "production" ? "production" : "sandbox";
  if (rolloutStage === "PRODUCTION" && paymentEnvironment !== "production") {
    return { ok: false, detail: `Rollout stage is PRODUCTION but PAYMENT_ENVIRONMENT is "${paymentEnvironment}" — refusing to process real payments against non-production credentials.` };
  }
  if (rolloutStage !== "PRODUCTION" && paymentEnvironment === "production") {
    return { ok: false, detail: `PAYMENT_ENVIRONMENT is "production" but rollout stage is ${rolloutStage} — refusing to risk real charges outside PRODUCTION stage.` };
  }
  return { ok: true, detail: `Provider "${activeProvider}" environment matches rollout stage.` };
}

// The single choke point every checkout entry point calls before creating a
// new Payment/Order (spec §70/§73). Never touches existing subscriptions,
// invoices, or refund processing — those remain available regardless of
// stage, exactly matching the kill-switch behavior the spec requires.
export async function assertPaymentsAvailable(profile: { id: string; country: string }, packageId: string | null): Promise<void> {
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  const stage = settings?.paymentRolloutStage ?? "DISABLED";
  const flags = await getPaymentFeatureFlags();

  if (stage === "DISABLED" || !flags.paymentsEnabled) {
    throw new PaymentsUnavailableError(NEUTRAL_UNAVAILABLE_MESSAGE);
  }

  // STEP 15 §56 — the system-wide emergency payments switch closes NEW checkout
  // sessions too (existing subscriptions/invoices/refunds stay untouched, same
  // as the rollout kill switch).
  if (await isEmergencyDisabled("payments")) {
    throw new PaymentsUnavailableError(NEUTRAL_UNAVAILABLE_MESSAGE);
  }

  const envCheck = validatePaymentEnvironmentSafety(settings?.activePaymentProvider ?? "MANUAL", stage);
  if (!envCheck.ok) {
    throw new PaymentsUnavailableError(NEUTRAL_UNAVAILABLE_MESSAGE);
  }

  if (!flags.checkoutEnabled) {
    throw new PaymentsUnavailableError(NEUTRAL_UNAVAILABLE_MESSAGE);
  }

  if (stage === "SANDBOX") {
    // Sandbox is for direct/staff testing, not real public users, unless
    // Manual is explicitly left on for hands-on verification (spec §65).
    if (!flags.manualPaymentEnabled) throw new PaymentsUnavailableError(NEUTRAL_UNAVAILABLE_MESSAGE);
    return;
  }

  if (stage === "INTERNAL") {
    const allowed = asStringArray(settings?.paymentInternalAllowedProfileIds);
    if (!allowed || !allowed.includes(profile.id)) {
      throw new PaymentsUnavailableError(NEUTRAL_UNAVAILABLE_MESSAGE);
    }
    return;
  }

  if (stage === "BETA") {
    if (!flags.betaEnabled) throw new PaymentsUnavailableError(NEUTRAL_UNAVAILABLE_MESSAGE);
    const eligible = isEligibleForPaymentBeta(profile, packageId, {
      betaPercentage: settings?.paymentBetaPercentage ?? 0,
      allowedProfileIds: asStringArray(settings?.paymentBetaAllowedProfileIds),
      allowedCountries: asStringArray(settings?.paymentBetaAllowedCountries),
      allowedPackageIds: asStringArray(settings?.paymentBetaAllowedPackageIds),
    });
    if (!eligible) throw new PaymentsUnavailableError(NEUTRAL_UNAVAILABLE_MESSAGE);
    return;
  }

  // PRODUCTION — open, subject to the flags already checked above.
  if (!flags.publicCheckoutEnabled) throw new PaymentsUnavailableError(NEUTRAL_UNAVAILABLE_MESSAGE);
}

export async function changeRolloutStage(params: { toStage: PaymentRolloutStage; reason: string; actorId: string }) {
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  const fromStage = settings?.paymentRolloutStage ?? "DISABLED";

  if (!isValidRolloutTransition(fromStage, params.toStage)) {
    throw new Error(`Cannot move payment rollout stage from ${fromStage} to ${params.toStage}.`);
  }

  await prisma.appSettings.update({ where: { id: 1 }, data: { paymentRolloutStage: params.toStage } });
  await prisma.paymentRolloutEvent.create({
    data: { fromStage, toStage: params.toStage, reason: params.reason, actorId: params.actorId },
  });
  await writeAudit({
    action: params.toStage === "DISABLED" ? "PAYMENT_KILL_SWITCH_USED" : "PAYMENT_ROLLOUT_CHANGED",
    adminId: params.actorId,
    meta: { fromStage, toStage: params.toStage, reason: params.reason },
  });

  return { fromStage, toStage: params.toStage };
}

// Computed from real DB state, not a static checklist a person can tick
// without doing the work (spec §65).
export async function getSandboxReadinessChecklist() {
  const [paid, failed, cancelledOrder, completedRefund, processedWebhook, activeSubscription, invoice] = await Promise.all([
    prisma.payment.findFirst({ where: { status: "PAID" } }),
    prisma.payment.findFirst({ where: { status: "FAILED" } }),
    prisma.order.findFirst({ where: { status: "CANCELLED" } }),
    prisma.refund.findFirst({ where: { status: "COMPLETED" } }),
    prisma.paymentWebhookEvent.findFirst({ where: { processedAt: { not: null } } }),
    prisma.subscription.findFirst({ where: { status: "ACTIVE" } }),
    prisma.invoice.findFirst(),
  ]);

  return {
    successfulPayment: Boolean(paid),
    failedPayment: Boolean(failed),
    cancelledOrder: Boolean(cancelledOrder),
    completedRefund: Boolean(completedRefund),
    processedWebhookEvent: Boolean(processedWebhook),
    activeSubscription: Boolean(activeSubscription),
    invoiceGenerated: Boolean(invoice),
  };
}

export async function getPaymentSystemHealth() {
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  const rolloutStage = settings?.paymentRolloutStage ?? "DISABLED";
  const activeProvider = settings?.activePaymentProvider ?? "MANUAL";
  const envCheck = validatePaymentEnvironmentSafety(activeProvider, rolloutStage);

  const [lastSuccessfulPayment, lastFailedPayment, lastWebhookSuccess, lastWebhookFailure, pendingPaymentsCount, lastReconciliationRun] = await Promise.all([
    prisma.payment.findFirst({ where: { status: "PAID" }, orderBy: { paidAt: "desc" } }),
    prisma.payment.findFirst({ where: { status: "FAILED" }, orderBy: { failedAt: "desc" } }),
    prisma.paymentWebhookEvent.findFirst({ where: { processedAt: { not: null } }, orderBy: { processedAt: "desc" } }),
    prisma.paymentWebhookEvent.findFirst({ where: { status: "FAILED" }, orderBy: { receivedAt: "desc" } }),
    prisma.payment.count({ where: { status: { in: ["CREATED", "PENDING", "PROCESSING"] } } }),
    prisma.reconciliationRun.findFirst({ orderBy: { startedAt: "desc" } }),
  ]);

  return {
    rolloutStage,
    activeProvider,
    environmentSafety: envCheck,
    lastSuccessfulPaymentAt: lastSuccessfulPayment?.paidAt ?? null,
    lastFailedPaymentAt: lastFailedPayment?.failedAt ?? null,
    lastSuccessfulWebhookAt: lastWebhookSuccess?.processedAt ?? null,
    lastFailedWebhookAt: lastWebhookFailure ? lastWebhookFailure.receivedAt : null,
    pendingPaymentsCount,
    lastReconciliationRun: lastReconciliationRun
      ? { id: lastReconciliationRun.id, completedAt: lastReconciliationRun.completedAt, discrepancyCount: lastReconciliationRun.discrepancyCount }
      : null,
    reconciliationFrequency: settings?.reconciliationFrequency ?? "DAILY",
    lastScheduledReconciliationAt: settings?.lastScheduledReconciliationAt ?? null,
  };
}

export async function getWebhookHealth() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // last 30 days
  const events = await prisma.paymentWebhookEvent.findMany({ where: { receivedAt: { gte: since } } });

  const total = events.length;
  const succeeded = events.filter((e) => e.processedAt !== null).length;
  const failed = events.filter((e) => e.status === "FAILED").length;
  const latencies = events
    .filter((e) => e.processedAt)
    .map((e) => e.processedAt!.getTime() - e.receivedAt.getTime());
  const avgProcessingMs = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;

  return { windowDays: 30, total, succeeded, failed, avgProcessingMs };
}

// Verifies the provider itself is reachable/configured (spec §67) — for
// MANUAL this is trivially true (no external dependency); for STRIPE it
// surfaces ProviderNotConfiguredError as "not configured" rather than a
// generic failure.
export async function getProviderHealth() {
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  const providerName = settings?.activePaymentProvider ?? "MANUAL";
  const provider = getProvider(providerName);
  if (providerName === "MANUAL") return { provider: providerName, configured: true, detail: "No external dependency." };
  try {
    await provider.getPayment("health-check-probe");
    return { provider: providerName, configured: true, detail: "Provider responded." };
  } catch (error) {
    return { provider: providerName, configured: false, detail: error instanceof Error ? error.message : "Provider is not reachable." };
  }
}

// Logs one system-detected payment incident as an INTERNAL Case (spec §82),
// reusing STEP 12's case-management system rather than a parallel table.
export async function reportPaymentIncident(params: { category: CaseCategory; subject: string; description: string }) {
  const caseNumber = await nextCaseNumber("INTERNAL");
  const { firstResponseDueAt, resolutionDueAt } = await computeSlaDueDates("HIGH");
  const created = await prisma.case.create({
    data: {
      caseNumber,
      type: "INTERNAL",
      category: params.category,
      subject: params.subject,
      description: params.description,
      priority: "HIGH",
      firstResponseDueAt,
      resolutionDueAt,
    },
  });

  // STEP 18 §34 — wraps the Case just created (reusing its real per-record
  // ACL via resourceType CASE) rather than a weaker permission-only PAYMENT
  // task, since the Case is already the actual system of record here.
  await createFromEvent({
    eventName: "RECONCILIATION_MISMATCH",
    dedupKey: `RECONCILIATION_MISMATCH:${created.id}`,
    resourceType: "CASE",
    resourceId: created.id,
    taskType: "RECONCILIATION_REVIEW",
    title: params.subject,
    priority: "HIGH",
  });

  return created;
}
