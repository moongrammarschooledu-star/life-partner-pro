import { prisma } from "@/lib/prisma";
import { analyticsAudit } from "@/lib/analytics/audit";
import { metricKeys, getMetric } from "@/lib/analytics/metrics/registry";
import { activeEventsOf, getAnalyticsSettings } from "@/lib/analytics/settings";
import { addDaysKey, dayDate, dayKey, dayStartUtc } from "@/lib/analytics/time";
import { versionNumber } from "@/lib/analytics/query-version";
import type { MetricComputeContext, MetricRange } from "@/lib/analytics/types";
import type { AnalyticsReconStatus, AnalyticsRunStatus } from "@prisma/client";

// STEP 31 — reconciliation. For each additive metric in a list, compare THREE independent figures for the same period:
//   operational  - an independent direct count/sum straight from the source tables (written separately from the metric's compute),
//   catalog      - the metric's own versioned compute run live over the whole period,
//   mart         - the sum of the stored daily rows.
// A metric is RECONCILED when all three agree exactly; otherwise the variance is shown. Money is compared per currency, in minor units.

interface Item { domain: string; metricKey: string; label: string; currency: string; operational: number | null; catalog: number | null; analytics: number | null }

const between = (r: MetricRange) => ({ gte: r.startUtc, lt: r.endUtc });
const PAID = ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] as const;

// Independent operational counts. Deliberately not shared with the metric implementations.
const OPERATIONAL: Record<string, { domain: string; run: (r: MetricRange) => Promise<Array<{ currency: string; value: number }>> }> = {
  "applicants.new": { domain: "applicants", run: async (r) => [{ currency: "", value: await prisma.profile.count({ where: { softDeleted: false, createdAt: between(r) } }) }] },
  "funnel.leads": { domain: "leads", run: async (r) => [{ currency: "", value: await prisma.lead.count({ where: { createdAt: between(r) } }) }] },
  "crm.leads": { domain: "leads", run: async (r) => [{ currency: "", value: await prisma.lead.count({ where: { createdAt: between(r) } }) }] },
  "matching.matches_generated": { domain: "matching", run: async (r) => [{ currency: "", value: await prisma.match.count({ where: { createdAt: between(r) } }) }] },
  "communications.sent": { domain: "communications", run: async (r) => [{ currency: "", value: await prisma.communicationLog.count({ where: { sentAt: between(r), isTest: false } }) }] },
  "membership.started": { domain: "subscriptions", run: async (r) => [{ currency: "", value: await prisma.subscription.count({ where: { startDate: between(r) } }) }] },
  "membership.cancelled": { domain: "subscriptions", run: async (r) => [{ currency: "", value: await prisma.subscription.count({ where: { cancelledAt: between(r) } }) }] },
  "finance.gross_revenue": {
    domain: "payments",
    run: async (r) => {
      const rows = await prisma.payment.findMany({ where: { status: { in: [...PAID] }, paidAt: between(r) }, select: { currencyCode: true, amountMinor: true }, take: 50_000 });
      const m = new Map<string, number>();
      for (const p of rows) m.set(p.currencyCode, (m.get(p.currencyCode) ?? 0) + p.amountMinor);
      return [...m.entries()].map(([currency, value]) => ({ currency, value }));
    },
  },
  "finance.payments_successful": { domain: "payments", run: async (r) => [{ currency: "", value: await prisma.payment.count({ where: { status: { in: [...PAID] }, paidAt: between(r) } }) }] },
  "proposals.created": { domain: "proposals", run: async (r) => [{ currency: "", value: await prisma.proposal.count({ where: { createdAt: between(r), status: { notIn: ["DRAFT", "ARCHIVED"] } } }) }] },
  "support.opened": { domain: "support", run: async (r) => [{ currency: "", value: await prisma.case.count({ where: { createdAt: between(r) } }) }] },
};

export interface ReconciliationOutcome {
  runId: string;
  status: AnalyticsRunStatus;
  items: Array<{ domain: string; label: string; metricKey: string; currency: string; operational: number | null; analytics: number | null; variance: number | null; status: AnalyticsReconStatus; note: string | null }>;
  reconciled: number;
  variances: number;
  lastChecked: string;
}

// The comparison window ends YESTERDAY (a closed day), so today's still-changing numbers cannot cause a false variance.
export async function runReconciliation(actorId: string | null, opts: { days?: number; now?: Date } = {}): Promise<ReconciliationOutcome> {
  const settings = await getAnalyticsSettings();
  const tz = settings.timezone;
  const now = opts.now ?? new Date();
  const days = Math.min(Math.max(opts.days ?? 7, 1), 31);
  const toDay = addDaysKey(dayKey(now, tz), -1);
  const fromDay = addDaysKey(toDay, -(days - 1));
  const range: MetricRange = { fromDay, toDay, startUtc: dayStartUtc(fromDay, tz), endUtc: dayStartUtc(addDaysKey(toDay, 1), tz) };
  const ctx: MetricComputeContext = { tz, now, activeEvents: activeEventsOf(settings) };

  const run = await prisma.analyticsReconciliationRun.create({ data: { rangeFrom: dayDate(fromDay), rangeTo: dayDate(toDay), triggeredBy: actorId ?? "cron" } });
  const items: Item[] = [];
  const errors: string[] = [];
  for (const key of Object.keys(OPERATIONAL).filter((k) => metricKeys().includes(k))) {
    const def = getMetric(key)!;
    try {
      const [operational, live, stored] = await Promise.all([
        OPERATIONAL[key].run(range),
        def.compute[def.computeVersion](range, ctx, "ALL"),
        prisma.analyticsDailyMetric.groupBy({ by: ["currencyCode"], where: { metricKey: key, metricVersion: versionNumber(def), dimensionKey: "ALL", date: { gte: dayDate(fromDay), lte: dayDate(toDay) }, tenantId: settings.tenantId }, _sum: { value: true }, _count: { _all: true } }),
      ]);
      const currencies = new Set<string>([...operational.map((o) => o.currency), ...live.map((l) => l.currency), ...stored.map((s) => s.currencyCode)]);
      if (currencies.size === 0) currencies.add("");
      const coveredDays = stored.reduce((n, s) => Math.max(n, s._count._all), 0);
      for (const currency of currencies) {
        items.push({
          domain: OPERATIONAL[key].domain, metricKey: key, label: def.name, currency,
          operational: operational.find((o) => o.currency === currency)?.value ?? 0,
          catalog: live.find((l) => l.currency === currency)?.value ?? 0,
          analytics: stored.length && coveredDays >= days ? Number(stored.find((s) => s.currencyCode === currency)?._sum.value ?? 0) : null,
        });
      }
    } catch (error) {
      errors.push(`${key}: ${error instanceof Error ? error.message.slice(0, 100) : "failed"}`);
    }
  }

  const out: ReconciliationOutcome["items"] = [];
  let reconciled = 0;
  let variances = 0;
  for (const i of items) {
    const noMart = i.analytics === null;
    const variance = noMart ? (i.operational ?? 0) - (i.catalog ?? 0) : Math.max(Math.abs((i.operational ?? 0) - (i.catalog ?? 0)), Math.abs((i.operational ?? 0) - (i.analytics ?? 0)));
    const ok = (i.operational === i.catalog) && (noMart || i.operational === i.analytics);
    const status: AnalyticsReconStatus = ok ? "RECONCILED" : "VARIANCE";
    if (ok) reconciled++;
    else variances++;
    const note = noMart ? "The data mart does not yet cover this whole period; compared the source with the metric's live calculation only." : ok ? null : "Source, live calculation and stored daily figures differ. Rebuild the metric from source, then re-run.";
    out.push({ domain: i.domain, label: i.label, metricKey: i.metricKey, currency: i.currency, operational: i.operational, analytics: i.analytics ?? i.catalog, variance: Math.abs(variance), status, note });
    await prisma.analyticsReconciliationItem.create({ data: { runId: run.id, domain: i.domain, label: i.label, operationalValue: BigInt(i.operational ?? 0), analyticsValue: BigInt(i.analytics ?? i.catalog ?? 0), variance: BigInt(Math.abs(variance)), currencyCode: i.currency, status, note } });
  }
  const status: AnalyticsRunStatus = errors.length ? "PARTIAL" : "SUCCEEDED";
  await prisma.analyticsReconciliationRun.update({ where: { id: run.id }, data: { status, finishedAt: new Date(), summary: { reconciled, variances, errors: errors.slice(0, 5) } as never } });
  await analyticsAudit({ action: "ANALYTICS_RECONCILIATION_RUN", actorId, resource: "reconciliation", resourceId: run.id, after: { reconciled, variances, from: fromDay, to: toDay } });
  return { runId: run.id, status, items: out, reconciled, variances, lastChecked: new Date().toISOString() };
}

export async function latestReconciliation() {
  const run = await prisma.analyticsReconciliationRun.findFirst({ orderBy: { startedAt: "desc" }, include: { items: true } });
  if (!run) return null;
  return {
    runId: run.id, status: run.status, startedAt: run.startedAt, finishedAt: run.finishedAt, rangeFrom: run.rangeFrom, rangeTo: run.rangeTo,
    items: run.items.map((i) => ({ domain: i.domain, label: i.label, currency: i.currencyCode, operational: Number(i.operationalValue), analytics: Number(i.analyticsValue), variance: Number(i.variance), status: i.status, note: i.note })),
    reconciled: run.items.filter((i) => i.status === "RECONCILED").length, variances: run.items.filter((i) => i.status === "VARIANCE").length,
  };
}
