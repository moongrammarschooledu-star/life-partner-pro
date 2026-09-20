import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/observability/logger";
import { Prisma } from "@prisma/client";

// Data-integrity monitoring (spec §42). READ-ONLY: every check counts
// suspicious rows and reports them; nothing is ever auto-corrected — high-risk
// data changes need controlled, audited remediation by a human.

export interface IntegrityFinding {
  key: string;
  description: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  count: number;
}

interface Check {
  key: string;
  description: string;
  severity: IntegrityFinding["severity"];
  run: () => Promise<number>;
}

async function scalar(query: Prisma.Sql): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: number | bigint }>>(query);
  return Number(rows[0]?.n ?? 0);
}

const CHECKS: Check[] = [
  {
    key: "DUPLICATE_PAID_PAYMENTS",
    description: "Orders with more than one PAID payment (possible duplicate charge)",
    severity: "HIGH",
    run: async () => (await prisma.payment.groupBy({ by: ["orderId"], where: { status: "PAID" }, _count: { _all: true }, having: { orderId: { _count: { gt: 1 } } } })).length,
  },
  {
    key: "PAID_WITHOUT_INVOICE",
    description: "PAID payments whose order has no invoice",
    severity: "HIGH",
    run: () => prisma.payment.count({ where: { status: "PAID", order: { invoice: null } } }),
  },
  {
    key: "PAID_WITHOUT_TIMESTAMP",
    description: "PAID payments missing paidAt (impossible status combination)",
    severity: "MEDIUM",
    run: () => prisma.payment.count({ where: { status: "PAID", paidAt: null } }),
  },
  {
    key: "FAILED_WITH_PAID_TIMESTAMP",
    description: "FAILED payments that also carry a paidAt timestamp",
    severity: "MEDIUM",
    run: () => prisma.payment.count({ where: { status: "FAILED", paidAt: { not: null } } }),
  },
  {
    key: "COMPLETED_ORDER_WITHOUT_PAID_PAYMENT",
    description: "COMPLETED orders with no PAID payment",
    severity: "HIGH",
    run: () => prisma.order.count({ where: { status: "COMPLETED", payments: { none: { status: { in: ["PAID", "REFUNDED", "PARTIALLY_REFUNDED"] } } } } }),
  },
  {
    key: "ACTIVE_SUBSCRIPTION_PAST_END",
    description: "ACTIVE subscriptions more than 2 days past their end date (renewal sweep not applied)",
    severity: "MEDIUM",
    run: () => prisma.subscription.count({ where: { status: "ACTIVE", endDate: { lt: new Date(Date.now() - 2 * 86_400_000) } } }),
  },
  {
    key: "ACTIVE_SUBSCRIPTION_WITHOUT_PAYMENT",
    description: "ACTIVE (non-trial) subscriptions with no paid order behind them",
    severity: "HIGH",
    run: () => prisma.subscription.count({ where: { status: "ACTIVE", trialEndsAt: null, orders: { none: { status: { in: ["PAID", "COMPLETED"] } } } } }),
  },
  {
    key: "USAGE_EXCEEDS_ENTITLEMENT",
    description: "Feature usage above the entitlement limit of the active subscription",
    severity: "MEDIUM",
    run: () =>
      scalar(Prisma.sql`SELECT COUNT(*)::int AS n FROM "FeatureUsage" fu
        JOIN "Subscription" s ON s."profileId" = fu."profileId" AND s."status" IN ('ACTIVE','TRIAL','GRACE_PERIOD')
        JOIN "PackageEntitlement" pe ON pe."packageId" = s."packageId" AND pe."featureKey" = fu."featureKey"
        WHERE pe."limitValue" IS NOT NULL AND fu."usageCount" > pe."limitValue"`),
  },
  {
    key: "REFUNDS_EXCEED_PAYMENT",
    description: "Completed refunds totalling more than the payment amount",
    severity: "HIGH",
    run: () =>
      scalar(Prisma.sql`SELECT COUNT(*)::int AS n FROM (
        SELECT r."paymentId", SUM(r."amountMinor") AS refunded FROM "Refund" r WHERE r."status" = 'COMPLETED' GROUP BY r."paymentId") x
        JOIN "Payment" p ON p."id" = x."paymentId" WHERE x.refunded > p."amountMinor"`),
  },
  {
    key: "STUCK_WEBHOOK_EVENTS",
    description: "Payment webhook events still RECEIVED after more than 1 hour (processing never finished)",
    severity: "MEDIUM",
    run: () => prisma.paymentWebhookEvent.count({ where: { status: "RECEIVED", receivedAt: { lt: new Date(Date.now() - 3_600_000) } } }),
  },
  {
    key: "ORPHAN_CASE_PAYMENT_LINKS",
    description: "Cases referencing a payment/invoice that no longer exists (plain-id links, no FK)",
    severity: "LOW",
    run: () =>
      scalar(Prisma.sql`SELECT COUNT(*)::int AS n FROM "Case" c
        WHERE (c."relatedPaymentId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Payment" p WHERE p."id" = c."relatedPaymentId"))
           OR (c."relatedInvoiceId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Invoice" i WHERE i."id" = c."relatedInvoiceId"))`),
  },
  {
    key: "PROFILES_WITHOUT_CONTACT_INFO",
    description: "Profiles with no contact-info row (incomplete registration record)",
    severity: "LOW",
    run: () => scalar(Prisma.sql`SELECT COUNT(*)::int AS n FROM "Profile" p WHERE NOT EXISTS (SELECT 1 FROM "ContactInfo" c WHERE c."profileId" = p."id")`),
  },
  {
    key: "PAID_PAYMENT_WITHOUT_AUDIT",
    description: "PAID payments (last 30 days) with no matching payment audit record",
    severity: "MEDIUM",
    run: () =>
      scalar(Prisma.sql`SELECT COUNT(*)::int AS n FROM "Payment" p
        WHERE p."status" = 'PAID' AND p."paidAt" > NOW() - INTERVAL '30 days'
          AND NOT EXISTS (SELECT 1 FROM "AuditLog" a WHERE a."action" IN ('PAYMENT_STATUS_CHANGED','MANUAL_PAYMENT_VERIFIED') AND a."meta" LIKE '%' || p."id" || '%')`),
  },
  {
    key: "COMPLETED_REFUND_WITHOUT_AUDIT",
    description: "COMPLETED refunds with no REFUND_EXECUTED audit record",
    severity: "MEDIUM",
    run: () =>
      scalar(Prisma.sql`SELECT COUNT(*)::int AS n FROM "Refund" r
        WHERE r."status" = 'COMPLETED' AND NOT EXISTS (SELECT 1 FROM "AuditLog" a WHERE a."action" = 'REFUND_EXECUTED' AND a."meta" LIKE '%' || r."id" || '%')`),
  },
];

export async function runIntegrityChecks(params: { trigger: "SCHEDULED" | "MANUAL" | "POST_RESTORE"; actorId?: string | null }) {
  const run = await prisma.integrityCheckRun.create({ data: { trigger: params.trigger, status: "RUNNING", triggeredById: params.actorId ?? null } });
  const findings: IntegrityFinding[] = [];
  let errors = 0;

  for (const check of CHECKS) {
    try {
      const count = await check.run();
      if (count > 0) findings.push({ key: check.key, description: check.description, severity: check.severity, count });
    } catch (error) {
      errors++;
      logger.warn("integrity_check_error", { key: check.key, reason: error instanceof Error ? error.message : "unknown" });
      findings.push({ key: `${check.key}__CHECK_ERROR`, description: `The check "${check.key}" could not run`, severity: "LOW", count: 1 });
    }
  }

  const status = errors === CHECKS.length ? "FAILED" : findings.length > 0 ? "FINDINGS" : "CLEAN";
  await prisma.integrityCheckRun.update({
    where: { id: run.id },
    data: { completedAt: new Date(), status, totalChecks: CHECKS.length, findingCount: findings.length, findings: findings as unknown as Prisma.InputJsonValue },
  });
  await writeAudit({ action: "INTEGRITY_CHECK_RUN", adminId: params.actorId ?? null, meta: { runId: run.id, trigger: params.trigger, status, findings: findings.length } });

  if (findings.some((f) => f.severity === "HIGH")) {
    const { raiseAlert } = await import("@/lib/ops/alerts");
    await raiseAlert({ category: "DATA_INTEGRITY", severity: "HIGH", source: "integrity-check", service: "database", title: "Data integrity checks found high-severity findings", detail: findings.filter((f) => f.severity === "HIGH").map((f) => `${f.key}: ${f.count}`).join(", "), dedupKey: "DATA_INTEGRITY" });
  }
  return { runId: run.id, status, totalChecks: CHECKS.length, findings };
}

export const INTEGRITY_CHECK_COUNT = CHECKS.length;

// Post-restore validation (spec §59): connectivity + presence of the core
// data sets + the integrity checks above. Read-only.
export async function runPostRestoreValidation(actorId: string | null) {
  const results: Array<{ name: string; status: "PASS" | "FAIL"; detail: string }> = [];
  const tally = async (name: string, fn: () => Promise<number>, mustExist = false) => {
    try {
      const n = await fn();
      results.push({ name, status: mustExist && n === 0 ? "FAIL" : "PASS", detail: `${n} record(s)` });
    } catch (error) {
      results.push({ name, status: "FAIL", detail: error instanceof Error ? error.message.slice(0, 100) : "error" });
    }
  };

  await tally("Database connectivity", async () => (await prisma.$queryRaw<Array<{ n: number }>>`SELECT 1 AS n`).length, true);
  await tally("Admin users", () => prisma.adminUser.count(), true);
  await tally("Permission definitions", () => prisma.permissionDef.count());
  await tally("Profiles", () => prisma.profile.count());
  await tally("Proposals", () => prisma.proposal.count());
  await tally("Matches", () => prisma.match.count());
  await tally("Verification records", () => prisma.profileVerification.count());
  await tally("Notifications", () => prisma.notification.count());
  await tally("Payments", () => prisma.payment.count());
  await tally("Subscriptions", () => prisma.subscription.count());
  await tally("Invoices", () => prisma.invoice.count());
  await tally("Audit logs", () => prisma.auditLog.count());
  await tally("Consent ledger", () => prisma.consentGrant.count());

  const integrity = await runIntegrityChecks({ trigger: "POST_RESTORE", actorId });
  results.push({ name: "Integrity checks", status: integrity.findings.some((f) => f.severity === "HIGH") ? "FAIL" : "PASS", detail: `${integrity.findings.length} finding(s)` });
  return { passed: results.every((r) => r.status === "PASS"), results };
}
