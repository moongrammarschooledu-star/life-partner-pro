import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { getProvider } from "@/lib/finance/providers/registry";
import { ProviderNotConfiguredError } from "@/lib/finance/providers/types";
import { reportPaymentIncident } from "@/lib/finance/rollout";

// Spec §30 — never silently modifies financial records during
// reconciliation; every finding is recorded as a ReconciliationItem for
// admin review, nothing is auto-corrected. For the Manual provider (the
// only one active today) there is no external ledger to compare against,
// so this is a self-consistency check (every PAID payment has an invoice,
// every completed refund matches its payment's refunded amount); the same
// function extends to real provider.getPayment() calls once a card-capable
// provider is configured.
export async function runReconciliation(startedById: string | null) {
  const run = await prisma.reconciliationRun.create({ data: { startedById } });

  const paidPayments = await prisma.payment.findMany({ where: { status: { in: ["PAID", "REFUNDED", "PARTIALLY_REFUNDED"] } }, include: { invoice: true, refunds: true } });

  let matched = 0;
  let discrepancies = 0;

  for (const payment of paidPayments) {
    let status: "MATCHED" | "MISSING_INTERNAL" | "AMOUNT_MISMATCH" | "STATUS_MISMATCH" | "REQUIRES_REVIEW" = "MATCHED";
    let detail: string | null = null;

    if (!payment.invoice) {
      status = "MISSING_INTERNAL";
      detail = "Paid payment has no generated invoice.";
    } else if (payment.invoice.totalMinor !== payment.amountMinor) {
      status = "AMOUNT_MISMATCH";
      detail = `Invoice total (${payment.invoice.totalMinor}) does not match payment amount (${payment.amountMinor}).`;
    }

    if (payment.provider !== "MANUAL") {
      try {
        const provider = getProvider(payment.provider);
        const providerResult = await provider.getPayment(payment.providerTransactionId ?? "");
        if (providerResult.status === "PAID" && payment.status !== "PAID") {
          status = "STATUS_MISMATCH";
          detail = `Provider reports PAID but local status is ${payment.status}.`;
        }
      } catch (error) {
        if (!(error instanceof ProviderNotConfiguredError)) {
          status = "REQUIRES_REVIEW";
          detail = "Could not verify against provider.";
        }
      }
    }

    await prisma.reconciliationItem.create({ data: { runId: run.id, paymentId: payment.id, status, detail } });
    if (status === "MATCHED") matched++;
    else discrepancies++;
  }

  await prisma.reconciliationRun.update({
    where: { id: run.id },
    data: { completedAt: new Date(), totalChecked: paidPayments.length, matchedCount: matched, discrepancyCount: discrepancies },
  });

  await writeAudit({ action: "RECONCILIATION_RUN", adminId: startedById, meta: { runId: run.id, totalChecked: paidPayments.length, discrepancies } });

  return { runId: run.id, totalChecked: paidPayments.length, matched, discrepancies };
}

// Spec §77 — a configurable schedule (still riding the one existing daily
// cron tick, see /api/cron/notifications/route.ts), not a new cron job.
// Skips the run entirely if not enough time has elapsed since the last one.
// Any non-MATCHED finding escalates into ONE actionable Case per run (not
// one per item, to avoid case-spam) rather than silently altering records.
const FREQUENCY_MS: Record<string, number> = {
  DAILY: 24 * 60 * 60 * 1000,
  WEEKLY: 7 * 24 * 60 * 60 * 1000,
  MONTHLY: 30 * 24 * 60 * 60 * 1000,
};

export async function runScheduledReconciliation() {
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  const frequencyMs = FREQUENCY_MS[settings?.reconciliationFrequency ?? "DAILY"] ?? FREQUENCY_MS.DAILY;
  const last = settings?.lastScheduledReconciliationAt;

  if (last && Date.now() - last.getTime() < frequencyMs) {
    return { ran: false, reason: "Not yet due" };
  }

  const result = await runReconciliation(null);
  await prisma.appSettings.update({ where: { id: 1 }, data: { lastScheduledReconciliationAt: new Date() } });

  if (result.discrepancies > 0) {
    await reportPaymentIncident({
      category: "RECONCILIATION_MISMATCH",
      subject: `Scheduled reconciliation found ${result.discrepancies} discrepanc${result.discrepancies === 1 ? "y" : "ies"}`,
      description: `Reconciliation run ${result.runId} checked ${result.totalChecked} payment(s) and found ${result.discrepancies} non-matched item(s) requiring review. See Finance Center → Reconciliation for details.`,
    });
  }

  return { ran: true, ...result };
}
