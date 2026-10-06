import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { analyticsAudit } from "@/lib/analytics/audit";
import { getAnalyticsSettings } from "@/lib/analytics/settings";
import type { AnalyticsIssueStatus, AnalyticsSeverity } from "@prisma/client";
import type { Viewer } from "@/lib/analytics/access";

// STEP 31 — data-quality checks. Each check is one bounded, fixed, parameter-free (or parameterised) query over operational data that
// reports OPAQUE record ids only — never names, contact details or amounts tied to a person. A problem found creates (or re-opens)
// one AnalyticsDataQualityIssue per (check, record); a problem that is no longer found resolves itself. Ignoring an issue needs a reason.

const LIMIT = 200;

interface Finding { subjectRef: string; subjectType: string; detail?: Record<string, string | number | boolean | null> }
interface Check { key: string; label: string; severity: AnalyticsSeverity; run: (now: Date) => Promise<Finding[]> }

const ids = (rows: Array<{ id: string }>, type: string, detail?: Finding["detail"]): Finding[] => rows.map((r) => ({ subjectRef: r.id, subjectType: type, detail }));

export const CHECKS: Check[] = [
  {
    key: "PAYMENT_DUPLICATE_PAID_FOR_ORDER", label: "More than one paid payment for the same order", severity: "CRITICAL",
    run: async () => ids(await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "orderId" AS id FROM "Payment" WHERE "status"::text IN ('PAID','PARTIALLY_REFUNDED','REFUNDED') GROUP BY "orderId" HAVING COUNT(*) > 1 LIMIT ${LIMIT}`), "order"),
  },
  {
    key: "PAYMENT_NON_POSITIVE_AMOUNT", label: "A paid payment with a zero or negative amount", severity: "CRITICAL",
    run: async () => ids(await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "Payment" WHERE "status"::text IN ('PAID','PARTIALLY_REFUNDED','REFUNDED') AND "amountMinor" <= 0 LIMIT ${LIMIT}`), "payment"),
  },
  {
    key: "PAYMENT_PAID_WITHOUT_DATE", label: "A paid payment with no paid date", severity: "WARNING",
    run: async () => ids(await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "Payment" WHERE "status"::text IN ('PAID','PARTIALLY_REFUNDED','REFUNDED') AND "paidAt" IS NULL LIMIT ${LIMIT}`), "payment"),
  },
  {
    key: "REFUND_EXCEEDS_PAYMENT", label: "Completed refunds add up to more than the payment", severity: "CRITICAL",
    run: async () => ids(await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT p.id FROM "Payment" p JOIN "Refund" r ON r."paymentId" = p.id WHERE r."status"::text = 'COMPLETED' GROUP BY p.id, p."amountMinor" HAVING SUM(r."amountMinor") > p."amountMinor" LIMIT ${LIMIT}`), "payment"),
  },
  {
    key: "PROPOSAL_MARRIED_WITHOUT_DATE", label: "A proposal marked married with no marriage date", severity: "WARNING",
    run: async () => ids(await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "Proposal" WHERE "status"::text = 'MARRIED' AND "marriedAt" IS NULL LIMIT ${LIMIT}`), "proposal"),
  },
  {
    key: "PROPOSAL_FINALIZED_WITHOUT_DATE", label: "A proposal marked finalized with no finalized date", severity: "WARNING",
    run: async () => ids(await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "Proposal" WHERE "status"::text = 'FINALIZED' AND "finalizedAt" IS NULL LIMIT ${LIMIT}`), "proposal"),
  },
  {
    key: "PROPOSAL_RESPONSE_FROM_NON_PARTICIPANT", label: "A proposal response from someone who is not part of the proposal", severity: "CRITICAL",
    run: async () => ids(await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT pr.id FROM "ProposalResponse" pr JOIN "Proposal" p ON p.id = pr."proposalId" WHERE pr."profileId" <> p."profileAId" AND pr."profileId" <> p."profileBId" LIMIT ${LIMIT}`), "proposal_response"),
  },
  {
    key: "LEAD_BROKEN_PROFILE_LINK", label: "A lead points at an applicant that does not exist", severity: "WARNING",
    run: async () => ids(await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT l.id FROM "Lead" l LEFT JOIN "Profile" p ON p.id = l."convertedProfileId" WHERE l."convertedProfileId" IS NOT NULL AND p.id IS NULL LIMIT ${LIMIT}`), "lead"),
  },
  {
    key: "PROFILE_WITHOUT_VERIFICATION_RECORD", label: "An applicant with no verification record", severity: "INFO",
    run: async () => ids(await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT p.id FROM "Profile" p LEFT JOIN "ProfileVerification" v ON v."profileId" = p.id WHERE p."softDeleted" = false AND v.id IS NULL LIMIT ${LIMIT}`), "profile"),
  },
  {
    key: "CAMPAIGN_LEAD_WITHOUT_ATTRIBUTION", label: "A campaign lead with no attribution record", severity: "INFO",
    run: async () => ids(await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT l.id FROM "Lead" l LEFT JOIN "LeadAttribution" a ON a."leadId" = l.id WHERE l."campaignId" IS NOT NULL AND a.id IS NULL LIMIT ${LIMIT}`), "lead"),
  },
  {
    key: "FUTURE_DATED_RECORD", label: "A record dated in the future", severity: "WARNING",
    run: async (now) => {
      const limit = new Date(now.getTime() + 86_400_000);
      const [profiles, payments, proposals] = await Promise.all([
        prisma.profile.findMany({ where: { createdAt: { gt: limit } }, select: { id: true }, take: 50 }),
        prisma.payment.findMany({ where: { paidAt: { gt: limit } }, select: { id: true }, take: 50 }),
        prisma.proposal.findMany({ where: { createdAt: { gt: limit } }, select: { id: true }, take: 50 }),
      ]);
      return [...ids(profiles, "profile"), ...ids(payments, "payment"), ...ids(proposals, "proposal")];
    },
  },
  {
    key: "MART_NEGATIVE_VALUE", label: "A data-mart value below zero", severity: "CRITICAL",
    run: async () => ids(await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT DISTINCT "metricKey" AS id FROM "AnalyticsDailyMetric" WHERE "value" < 0 LIMIT ${LIMIT}`), "metric"),
  },
  {
    key: "MART_STALE", label: "The data marts have not refreshed within the allowed time", severity: "WARNING",
    run: async (now) => {
      const settings = await getAnalyticsSettings();
      if (!(await isFeatureEnabled("analytics.pipeline.enabled"))) return [];
      const latest = await prisma.analyticsMart.findFirst({ orderBy: { lastRefreshedAt: "desc" }, select: { lastRefreshedAt: true } });
      if (!latest?.lastRefreshedAt) return [{ subjectRef: "GLOBAL", subjectType: "mart", detail: { reason: "never refreshed" } }];
      return now.getTime() - latest.lastRefreshedAt.getTime() > settings.freshnessSlaHours * 3_600_000 ? [{ subjectRef: "GLOBAL", subjectType: "mart", detail: { reason: "older than the allowed time" } }] : [];
    },
  },
];

export interface QualityRunResult { checked: number; found: number; opened: number; autoResolved: number; byCheck: Record<string, number>; errors: string[] }

export async function runDataQualityChecks(now: Date = new Date()): Promise<QualityRunResult> {
  let found = 0;
  let opened = 0;
  let autoResolved = 0;
  const byCheck: Record<string, number> = {};
  const errors: string[] = [];
  for (const check of CHECKS) {
    let findings: Finding[];
    try {
      findings = await check.run(now);
    } catch (error) {
      errors.push(`${check.key}: ${error instanceof Error ? error.message.slice(0, 100) : "failed"}`);
      continue;
    }
    byCheck[check.key] = findings.length;
    found += findings.length;
    const seen = new Set<string>();
    for (const f of findings) {
      seen.add(f.subjectRef);
      const existing = await prisma.analyticsDataQualityIssue.findUnique({ where: { checkKey_subjectRef: { checkKey: check.key, subjectRef: f.subjectRef } } });
      if (!existing) {
        await prisma.analyticsDataQualityIssue.create({ data: { checkKey: check.key, subjectRef: f.subjectRef, subjectType: f.subjectType, severity: check.severity, detail: (f.detail ?? { label: check.label }) as never } });
        opened++;
      } else {
        // a resolved problem that came back is re-opened; an ignored one stays ignored
        await prisma.analyticsDataQualityIssue.update({ where: { id: existing.id }, data: { lastSeenAt: now, ...(existing.status === "RESOLVED" ? { status: "OPEN", resolvedAt: null } : {}) } });
        if (existing.status === "RESOLVED") opened++;
      }
    }
    // anything open for this check that is no longer found has fixed itself
    const stale = await prisma.analyticsDataQualityIssue.findMany({ where: { checkKey: check.key, status: { in: ["OPEN", "INVESTIGATING"] }, subjectRef: { notIn: [...seen] } }, select: { id: true }, take: 500 });
    if (stale.length) {
      await prisma.analyticsDataQualityIssue.updateMany({ where: { id: { in: stale.map((s) => s.id) } }, data: { status: "RESOLVED", resolvedAt: now } });
      autoResolved += stale.length;
    }
  }
  return { checked: CHECKS.length, found, opened, autoResolved, byCheck, errors };
}

export async function listIssues(filter: { status?: string; take?: number } = {}) {
  const rows = await prisma.analyticsDataQualityIssue.findMany({ where: filter.status ? { status: filter.status as AnalyticsIssueStatus } : {}, orderBy: [{ status: "asc" }, { detectedAt: "desc" }], take: Math.min(filter.take ?? 100, 300) });
  const label = new Map(CHECKS.map((c) => [c.key, c.label]));
  return rows.map((r) => ({ id: r.id, checkKey: r.checkKey, label: label.get(r.checkKey) ?? r.checkKey, subjectType: r.subjectType, subjectRef: r.subjectRef, severity: r.severity, status: r.status, ignoreReason: r.ignoreReason, detectedAt: r.detectedAt, lastSeenAt: r.lastSeenAt }));
}

export async function setIssueStatus(actor: Viewer, id: string, status: AnalyticsIssueStatus, reason?: string) {
  const issue = await prisma.analyticsDataQualityIssue.findUnique({ where: { id } });
  if (!issue) throw new HttpError(404, "Issue not found.");
  if (status === "IGNORED_WITH_REASON" && (reason ?? "").trim().length < 5) throw new HttpError(422, "A reason is required to ignore an issue.");
  if (!["OPEN", "INVESTIGATING", "RESOLVED", "IGNORED_WITH_REASON"].includes(status)) throw new HttpError(422, "Unknown status.");
  const row = await prisma.analyticsDataQualityIssue.update({
    where: { id },
    data: { status, handledById: actor.id, ignoreReason: status === "IGNORED_WITH_REASON" ? reason!.trim().slice(0, 300) : null, resolvedAt: status === "RESOLVED" ? new Date() : null },
  });
  await analyticsAudit({ action: "ANALYTICS_DATA_QUALITY_CHANGED", actorId: actor.id, resource: "data_quality_issue", resourceId: id, before: { status: issue.status }, after: { status }, reason: reason ?? null });
  return row;
}

export async function qualitySummary() {
  const g = await prisma.analyticsDataQualityIssue.groupBy({ by: ["status", "severity"], _count: { _all: true } });
  return g.map((x) => ({ status: x.status, severity: x.severity, count: x._count._all }));
}
