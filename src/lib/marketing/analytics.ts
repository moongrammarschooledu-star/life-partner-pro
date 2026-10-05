import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MIN_SAMPLE_SIZE, safeRate } from "@/lib/reports/sample-size";

// STEP 29 §21–§23/§52 — marketing analytics. Everything is aggregated in the database (groupBy / count / SQL) — no event
// rows are ever loaded into memory or sent to the browser. The funnel deliberately STOPS at "active applicants": it never
// extends to matching outcomes, finalisation or marriage, and ad-platform numbers (impressions/clicks/spend) are kept
// visibly separate from our own lead/registration/verification numbers. Rates return null below MIN_SAMPLE_SIZE.

export const ACTIVE_APPLICANT_STAGES = [
  "ACTIVE", "MATCHING", "PROPOSAL_ACTIVE", "WAITING_FOR_RESPONSE", "MUTUAL_INTEREST", "CONTACT_COORDINATION",
  "MEETING_SCHEDULED", "MEETING_COMPLETED", "FOLLOWUP", "FURTHER_DISCUSSION",
] as const;

export const ROI_UNAVAILABLE_MESSAGE = "Insufficient verified data for ROI calculation.";

export type RoiResult =
  | { status: "INSUFFICIENT_DATA"; message: string }
  | { status: "CALCULATED"; spendMinor: number; revenueMinor: number; roiPct: number; methodology: string };

export const ROI_METHODOLOGY = "Single-touch. Revenue = PAID payments (same currency) by applicants converted from VERIFIED-attribution leads of this campaign, paid after the lead was captured. Provider-verified spend only.";

// Pure. Never calculates ROI without verified spend, a configured attribution model and positive attributed revenue.
export function computeRoi(input: { spendVerified: boolean; spendMinor: number; attributionModel: string | null; revenueMinor: number | null }): RoiResult {
  if (!input.spendVerified || input.spendMinor <= 0 || !input.attributionModel || input.revenueMinor === null || input.revenueMinor <= 0) {
    return { status: "INSUFFICIENT_DATA", message: ROI_UNAVAILABLE_MESSAGE };
  }
  return { status: "CALCULATED", spendMinor: input.spendMinor, revenueMinor: input.revenueMinor, roiPct: Math.round(((input.revenueMinor - input.spendMinor) / input.spendMinor) * 100), methodology: ROI_METHODOLOGY };
}

// Pure. Integer minor units; null when there is no honest denominator.
export function unitCost(spendMinor: number, count: number, perThousand = false): number | null {
  if (count <= 0 || spendMinor < 0) return null;
  return Math.round((spendMinor / count) * (perThousand ? 1000 : 1));
}

export interface AnalyticsFilter {
  from: Date;
  to: Date;
  campaignId?: string | null;
}

interface FunnelRow {
  registrations: number;
  completed: number;
  verified: number;
  active: number;
}

export async function computeMarketingAnalytics(f: AnalyticsFilter) {
  const campaignClause = f.campaignId ? Prisma.sql`AND l."campaignId" = ${f.campaignId}` : Prisma.sql``;
  const campaignWhere = f.campaignId ? { campaignId: f.campaignId } : {};

  const [campaignCounts, adAgg, pageViews, leadsTotal, funnelRaw, bySourceRaw, byChannelRaw, leadsByDayRaw, topCampaignsRaw] = await Promise.all([
    prisma.marketingCampaign.groupBy({ by: ["status"], _count: { status: true } }),
    prisma.marketingMetricDaily.aggregate({
      where: { isSandbox: false, date: { gte: f.from, lte: f.to }, ...campaignWhere },
      _sum: { impressions: true, reach: true, clicks: true, spendMinor: true, providerLeads: true },
    }),
    prisma.marketingEvent.count({ where: { type: "LANDING_PAGE_VIEW", occurredAt: { gte: f.from, lte: f.to }, ...campaignWhere } }),
    prisma.lead.count({ where: { campaignId: f.campaignId ?? { not: null }, capturedAt: { gte: f.from, lte: f.to } } }),
    prisma.$queryRaw<FunnelRow[]>(Prisma.sql`
      SELECT count(*)::int AS registrations,
             (count(*) FILTER (WHERE p."profileCompletion" >= 100))::int AS completed,
             (count(*) FILTER (WHERE p.verified))::int AS verified,
             (count(*) FILTER (WHERE c."lifecycleStage"::text IN (${Prisma.join([...ACTIVE_APPLICANT_STAGES])})))::int AS active
      FROM "Lead" l
      JOIN "Profile" p ON p.id = l."convertedProfileId"
      LEFT JOIN "CrmRecord" c ON c."profileId" = p.id
      WHERE l."campaignId" IS NOT NULL AND l."capturedAt" >= ${f.from} AND l."capturedAt" <= ${f.to} ${campaignClause}`),
    prisma.$queryRaw<Array<{ source: string | null; medium: string | null; leads: number }>>(Prisma.sql`
      SELECT l."utmSource" AS source, l."utmMedium" AS medium, count(*)::int AS leads
      FROM "Lead" l
      WHERE l."campaignId" IS NOT NULL AND l."capturedAt" >= ${f.from} AND l."capturedAt" <= ${f.to} ${campaignClause}
      GROUP BY 1, 2 ORDER BY leads DESC LIMIT 20`),
    prisma.$queryRaw<Array<{ channel: string; leads: number }>>(Prisma.sql`
      SELECT c.channel::text AS channel, count(l.id)::int AS leads
      FROM "Lead" l JOIN "MarketingCampaign" c ON c.id = l."campaignId"
      WHERE l."capturedAt" >= ${f.from} AND l."capturedAt" <= ${f.to} ${campaignClause}
      GROUP BY 1 ORDER BY leads DESC`),
    prisma.$queryRaw<Array<{ day: Date; leads: number }>>(Prisma.sql`
      SELECT date_trunc('day', l."capturedAt") AS day, count(*)::int AS leads
      FROM "Lead" l
      WHERE l."campaignId" IS NOT NULL AND l."capturedAt" >= ${f.from} AND l."capturedAt" <= ${f.to} ${campaignClause}
      GROUP BY 1 ORDER BY 1`),
    prisma.$queryRaw<Array<{ id: string; code: string; name: string; status: string; channel: string; leads: number; spendVerifiedMinor: number; spendVerified: boolean; currencyCode: string; attributionModel: string | null }>>(Prisma.sql`
      SELECT c.id, c.code, c.name, c.status::text AS status, c.channel::text AS channel, count(l.id)::int AS leads,
             c."spendVerifiedMinor", c."spendVerified", c."currencyCode", c."attributionModel"
      FROM "MarketingCampaign" c
      LEFT JOIN "Lead" l ON l."campaignId" = c.id AND l."capturedAt" >= ${f.from} AND l."capturedAt" <= ${f.to}
      ${f.campaignId ? Prisma.sql`WHERE c.id = ${f.campaignId}` : Prisma.sql``}
      GROUP BY c.id ORDER BY leads DESC, c."createdAt" DESC LIMIT 20`),
  ]);

  const funnel = funnelRaw[0] ?? { registrations: 0, completed: 0, verified: 0, active: 0 };
  const sum = adAgg._sum;
  const impressions = sum.impressions ?? 0;
  const clicks = sum.clicks ?? 0;
  const spendMinor = sum.spendMinor ?? 0;
  const statusCount = (s: string) => campaignCounts.find((c) => c.status === s)?._count.status ?? 0;

  return {
    range: { from: f.from, to: f.to },
    campaigns: { total: campaignCounts.reduce((n, c) => n + c._count.status, 0), active: statusCount("ACTIVE"), draft: statusCount("DRAFT"), inReview: statusCount("IN_REVIEW") },
    // Ad-platform numbers (provider-reported, never sandbox). Empty until a live provider has synced.
    advertising: {
      impressions, reach: sum.reach ?? 0, clicks, spendMinor, providerLeads: sum.providerLeads ?? 0,
      ctrPct: safeRate(clicks, impressions) === null ? null : Math.round((clicks / impressions) * 10000) / 100,
      cpcMinor: unitCost(spendMinor, clicks),
      cpmMinor: unitCost(spendMinor, impressions, true),
      cplMinor: leadsTotal >= MIN_SAMPLE_SIZE ? unitCost(spendMinor, leadsTotal) : null,
      hasData: impressions > 0 || spendMinor > 0,
    },
    // Our own numbers. The chain stops at active applicants by design.
    funnel: {
      stages: [
        { key: "IMPRESSIONS", label: "Impressions", value: impressions, source: "provider" },
        { key: "CLICKS", label: "Clicks", value: clicks, source: "provider" },
        { key: "LANDING_PAGE_VISITS", label: "Landing page visits", value: pageViews, source: "internal" },
        { key: "LEADS", label: "Leads", value: leadsTotal, source: "internal" },
        { key: "REGISTRATIONS", label: "Registrations", value: funnel.registrations, source: "internal" },
        { key: "COMPLETED_PROFILES", label: "Completed profiles", value: funnel.completed, source: "internal" },
        { key: "VERIFIED_PROFILES", label: "Verified profiles", value: funnel.verified, source: "internal" },
        { key: "ACTIVE_APPLICANTS", label: "Active applicants", value: funnel.active, source: "internal" },
      ],
      rates: {
        leadToRegistrationPct: safeRate(funnel.registrations, leadsTotal),
        registrationToCompletedPct: safeRate(funnel.completed, funnel.registrations),
        registrationToVerifiedPct: safeRate(funnel.verified, funnel.registrations),
        visitToLeadPct: safeRate(leadsTotal, pageViews),
      },
      note: "Funnel ends at active applicants. A marketing conversion is never a match, meeting or marriage outcome.",
    },
    byChannel: byChannelRaw,
    bySource: bySourceRaw,
    leadsByDay: leadsByDayRaw.map((r) => ({ day: r.day, leads: r.leads })),
    topCampaigns: topCampaignsRaw.map((c) => ({
      ...c,
      cplMinor: c.spendVerified && c.leads >= MIN_SAMPLE_SIZE ? unitCost(c.spendVerifiedMinor, c.leads) : null,
    })),
  };
}

// Attributed revenue for one campaign (see ROI_METHODOLOGY). Null when there is nothing to attribute.
export async function attributedRevenueMinor(campaignId: string, currencyCode: string): Promise<number | null> {
  const rows = await prisma.$queryRaw<Array<{ revenue: number }>>(Prisma.sql`
    SELECT coalesce(sum(pay."amountMinor"), 0)::int AS revenue
    FROM "Payment" pay
    JOIN "Lead" l ON l."convertedProfileId" = pay."profileId"
    JOIN "LeadAttribution" a ON a."leadId" = l.id
    WHERE l."campaignId" = ${campaignId} AND a.verification::text = 'VERIFIED'
      AND pay.status::text = 'PAID' AND pay."currencyCode" = ${currencyCode}
      AND l."capturedAt" IS NOT NULL AND pay."paidAt" >= l."capturedAt"`);
  const v = rows[0]?.revenue ?? 0;
  return v > 0 ? v : null;
}

export async function computeCampaignRoi(campaignId: string): Promise<RoiResult> {
  const c = await prisma.marketingCampaign.findUnique({ where: { id: campaignId }, select: { spendVerified: true, spendVerifiedMinor: true, attributionModel: true, currencyCode: true } });
  if (!c) return { status: "INSUFFICIENT_DATA", message: ROI_UNAVAILABLE_MESSAGE };
  const revenue = c.spendVerified && c.attributionModel ? await attributedRevenueMinor(campaignId, c.currencyCode) : null;
  return computeRoi({ spendVerified: c.spendVerified, spendMinor: c.spendVerifiedMinor, attributionModel: c.attributionModel, revenueMinor: revenue });
}

// Aggregate-only attribution summary (no per-person rows).
export async function attributionSummary(campaignId: string | null) {
  const rows = await prisma.leadAttribution.groupBy({ by: ["verification"], where: campaignId ? { campaignId } : {}, _count: { verification: true } });
  return rows.map((r) => ({ verification: r.verification, count: r._count.verification }));
}
