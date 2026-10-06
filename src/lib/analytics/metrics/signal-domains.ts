import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ENGAGEMENT_NOTIFICATION_TYPES } from "@/lib/engagement/constants";
import { ALL, between, countOrGroup, metric, total } from "@/lib/analytics/metrics/helpers";
import { dayDate } from "@/lib/analytics/time";
import type { MetricDefinition, MetricRange, MetricRow } from "@/lib/analytics/types";

// STEP 31 — risk & safety, security, communications, engagement and marketing metrics. Risk and security show COUNTS and LEVELS only:
// internal risk scores are never exposed here. Communications never claims delivery without provider confirmation (deliveredAt).
// Marketing uses the same primitives and filters as marketing/analytics.ts (sandbox rows excluded; provider numbers kept apart
// from our own lead/registration numbers).

const OPEN_RISK = ["OPEN", "ACKNOWLEDGED", "UNDER_INVESTIGATION", "INFORMATION_REQUESTED", "ESCALATED"] as const;
const CLOSED_RISK = ["CLEARED", "DISMISSED", "FALSE_POSITIVE", "RESTRICTED", "SUSPENDED"] as const;
const OPEN_SIGNAL = ["OPEN", "INVESTIGATING", "ACKNOWLEDGED", "CONFIRMED"] as const;

export const RISK_METRICS: MetricDefinition[] = [
  metric({
    key: "risk.open_cases", name: "Open safety reviews", section: "risk", unit: "COUNT", kind: "SNAPSHOT",
    description: "Safety review cases that are open, by category or level.", formula: "Count of risk cases whose status is open, acknowledged, under investigation, information requested or escalated.", source: "RiskCase.status",
    dimensions: ["category", "level"], requires: ["analytics:risk:view"], note: "Counts and levels only. Internal risk scores are never shown.", synonyms: ["open safety reviews", "open risk cases", "safety reviews", "risk cases"],
    v1: (_r, _c, dim) => countOrGroup(prisma.riskCase as never, { status: { in: [...OPEN_RISK] } }, dim, dim === "category" ? "category" : dim === "level" ? "riskLevel" : undefined),
  }),
  metric({
    key: "risk.cases_opened", name: "Safety reviews opened", section: "risk", unit: "COUNT", kind: "PERIOD",
    description: "Safety review cases opened in the period.", formula: "Count of risk cases created in the period.", source: "RiskCase.createdAt",
    dimensions: ["category", "level"], requires: ["analytics:risk:view"], synonyms: ["safety reviews opened", "risk cases opened"],
    v1: (r, _c, dim) => countOrGroup(prisma.riskCase as never, { createdAt: between(r) }, dim, dim === "category" ? "category" : dim === "level" ? "riskLevel" : undefined),
  }),
  metric({
    key: "risk.cases_closed", name: "Safety reviews closed", section: "risk", unit: "COUNT", kind: "PERIOD",
    description: "Safety review cases closed in the period, by outcome (cleared, dismissed, false positive, restricted…).", formula: "Count of risk cases closed in the period, grouped by status.", source: "RiskCase.closedAt",
    dimensions: ["status"], requires: ["analytics:risk:view"], synonyms: ["cleared cases", "false positives", "closed risk cases", "safety reviews closed"],
    v1: (r, _c, dim) => countOrGroup(prisma.riskCase as never, { closedAt: between(r), status: { in: [...CLOSED_RISK] } }, dim, dim === "status" ? "status" : undefined),
  }),
  metric({
    key: "risk.avg_review_hours", name: "Average safety-review time", section: "risk", unit: "HOURS", kind: "PERIOD", isDuration: true,
    description: "Average time from opening to closing for safety reviews closed in the period.", formula: "Average of (closed − created) for risk cases closed in the period.", source: "RiskCase.createdAt, closedAt",
    requires: ["analytics:risk:view"], synonyms: ["average review time", "risk review time"],
    v1: async (r) => {
      const rows = await prisma.$queryRaw<Array<{ minutes: bigint | null; n: number }>>(Prisma.sql`SELECT COALESCE(SUM(EXTRACT(EPOCH FROM ("closedAt" - "createdAt")) / 60), 0)::bigint AS minutes, COUNT(*)::int AS n FROM "RiskCase" WHERE "closedAt" >= ${r.startUtc} AND "closedAt" < ${r.endUtc}`);
      return total(Number(rows[0]?.minutes ?? 0), Number(rows[0]?.n ?? 0));
    },
  }),
  metric({
    key: "risk.escalated", name: "Escalated safety reviews", section: "risk", unit: "COUNT", kind: "SNAPSHOT",
    description: "Safety reviews currently escalated.", formula: "Count of risk cases with status ESCALATED.", source: "RiskCase.status",
    requires: ["analytics:risk:view"], synonyms: ["escalated risk cases", "risk escalations", "escalations risk"],
    v1: async () => total(await prisma.riskCase.count({ where: { status: "ESCALATED" } })),
  }),
  metric({
    key: "risk.open_signals", name: "Open risk signals", section: "risk", unit: "COUNT", kind: "SNAPSHOT",
    description: "Risk signals still being looked at, by category.", formula: "Count of security flags that are open, investigating, acknowledged or confirmed.", source: "SecurityFlag.status",
    dimensions: ["category", "severity"], requires: ["analytics:risk:view"], synonyms: ["risk signals", "open signals", "unusual activity"],
    v1: (_r, _c, dim) => countOrGroup(prisma.securityFlag as never, { status: { in: [...OPEN_SIGNAL] } }, dim, dim === "category" ? "category" : dim === "severity" ? "severity" : undefined),
  }),
  metric({
    key: "risk.potential_duplicates", name: "Potential duplicates awaiting review", section: "risk", unit: "COUNT", kind: "SNAPSHOT",
    description: "Possible duplicate-profile groups waiting for a person to review them.", formula: "Count of duplicate clusters with status UNRESOLVED.", source: "DuplicateCluster.status",
    requires: ["analytics:risk:view"], synonyms: ["potential duplicates", "duplicate profiles", "duplicates"],
    v1: async () => total(await prisma.duplicateCluster.count({ where: { status: "UNRESOLVED" } })),
  }),
  metric({
    key: "risk.restrictions_active", name: "Account restrictions in force", section: "risk", unit: "COUNT", kind: "SNAPSHOT",
    description: "Account restrictions currently in force.", formula: "Count of profile restrictions that are active.", source: "ProfileRestriction.active",
    requires: ["analytics:risk:view"], synonyms: ["account restrictions", "restrictions"],
    v1: async () => total(await prisma.profileRestriction.count({ where: { active: true } })),
  }),
  metric({
    key: "security.events", name: "Security events", section: "risk", unit: "COUNT", kind: "PERIOD",
    description: "Security events recorded in the period, by event type (aggregate only).", formula: "Count of security events created in the period.", source: "SecurityEvent.createdAt",
    dimensions: ["event_type"], requires: ["analytics:security:view"], exclusions: ["no device, network or account identifiers"], synonyms: ["security events"],
    v1: (r, _c, dim) => countOrGroup(prisma.securityEvent as never, { createdAt: between(r) }, dim, dim === "event_type" ? "eventType" : undefined),
  }),
];

export const COMMUNICATION_METRICS: MetricDefinition[] = [
  metric({
    key: "communications.sent", name: "Messages sent", section: "communications", unit: "COUNT", kind: "PERIOD",
    description: "Messages handed to a delivery channel in the period (excluding test sends).", formula: "Count of communication logs with a sent time in the period and isTest = false.", source: "CommunicationLog.sentAt",
    dimensions: ["channel", "provider"], synonyms: ["messages sent", "emails sent", "sms sent", "whatsapp sent", "communications sent"],
    v1: (r, _c, dim) => countOrGroup(prisma.communicationLog as never, { sentAt: between(r), isTest: false }, dim, dim === "channel" ? "channel" : dim === "provider" ? "provider" : undefined),
  }),
  metric({
    key: "communications.delivered", name: "Messages delivered (provider-confirmed)", section: "communications", unit: "COUNT", kind: "PERIOD",
    description: "Messages the provider confirmed as delivered in the period. A message without provider confirmation is not counted as delivered.", formula: "Count of communication logs with a delivered time in the period and isTest = false.", source: "CommunicationLog.deliveredAt",
    dimensions: ["channel", "provider"], synonyms: ["delivered", "messages delivered"],
    v1: (r, _c, dim) => countOrGroup(prisma.communicationLog as never, { deliveredAt: between(r), isTest: false }, dim, dim === "channel" ? "channel" : dim === "provider" ? "provider" : undefined),
  }),
  metric({
    key: "communications.failed", name: "Messages failed", section: "communications", unit: "COUNT", kind: "PERIOD",
    description: "Messages that failed (including bounced or rejected) in the period.", formula: "Count of communication logs with delivery status FAILED, BOUNCED or REJECTED created in the period.", source: "CommunicationLog.deliveryStatus",
    dimensions: ["channel", "provider", "status"], synonyms: ["failed", "bounced", "provider failures", "failed messages"],
    v1: (r, _c, dim) => countOrGroup(prisma.communicationLog as never, { createdAt: between(r), isTest: false, deliveryStatus: { in: ["FAILED", "BOUNCED", "REJECTED"] } }, dim, dim === "channel" ? "channel" : dim === "provider" ? "provider" : dim === "status" ? "deliveryStatus" : undefined),
  }),
  metric({
    key: "communications.read", name: "Messages read (where supported)", section: "communications", unit: "COUNT", kind: "PERIOD",
    description: "Messages the channel reported as read in the period. Only some channels report this.", formula: "Count of communication logs with a read time in the period and isTest = false.", source: "CommunicationLog.readAt",
    dimensions: ["channel"], synonyms: ["read", "messages read"],
    v1: (r, _c, dim) => countOrGroup(prisma.communicationLog as never, { readAt: between(r), isTest: false }, dim, dim === "channel" ? "channel" : undefined),
  }),
  metric({
    key: "communications.delivery_rate", name: "Delivery rate (provider-confirmed)", section: "communications", unit: "PERCENT", kind: "PERIOD", isRate: true, liveOnly: true,
    description: "Of messages sent in the period, the share the provider confirmed as delivered.", formula: "Messages sent in the period that have a delivered time ÷ messages sent in the period × 100.", source: "CommunicationLog",
    exclusions: ["cohort figure: confirmations can arrive later"], synonyms: ["delivery rate"],
    v1: async (r) => total(await prisma.communicationLog.count({ where: { sentAt: between(r), isTest: false, deliveredAt: { not: null } } }), await prisma.communicationLog.count({ where: { sentAt: between(r), isTest: false } })),
  }),
  metric({
    key: "communications.in_app_notifications", name: "In-app notifications created", section: "communications", unit: "COUNT", kind: "PERIOD",
    description: "In-app notifications created in the period (applicants, staff and family).", formula: "Count of notifications created in the period.", source: "Notification.createdAt",
    synonyms: ["in-app notifications", "notifications", "in app"],
    v1: async (r) => total(await prisma.notification.count({ where: { createdAt: between(r) } })),
  }),
  metric({
    key: "communications.suppressions_active", name: "Active suppressions", section: "communications", unit: "COUNT", kind: "SNAPSHOT",
    description: "Contact destinations currently suppressed (opted out, bounced or blocked).", formula: "Count of suppressions with status ACTIVE.", source: "CommunicationSuppression.status",
    synonyms: ["suppression", "suppressions", "opt-outs", "opt outs", "optouts"],
    v1: async () => total(await prisma.communicationSuppression.count({ where: { status: "ACTIVE" } })),
  }),
];

export const ENGAGEMENT_METRICS: MetricDefinition[] = [
  ...(
    [
      ["engagement.profiles_completed", "Profiles completed (event)", "PROFILE_COMPLETED", ["profile completion", "profiles completed"]],
      ["engagement.verifications_completed", "Verifications completed (event)", "VERIFICATION_COMPLETED", ["verification completion"]],
      ["engagement.proposal_responses", "Proposal responses (event)", "PROPOSAL_RESPONSE_RECEIVED", ["proposal engagement", "responded to proposals"]],
      ["engagement.meetings_completed", "Meetings completed (event)", "MEETING_COMPLETED", ["meeting engagement"]],
      ["engagement.referrals_created", "Referrals created (event)", "REFERRAL_CREATED", ["referral activity", "referrals"]],
      ["engagement.logins", "Sign-in days (event)", "LOGIN", ["logins", "sign ins", "signins"]],
    ] as const
  ).map(([key, name, type, synonyms]) =>
    metric({
      key, name, section: "engagement", unit: "COUNT", kind: "PERIOD",
      description: `Engagement events of type ${type} recorded in the period.`, formula: `Count of engagement events of type ${type} in the period.`, source: "EngagementEvent",
      exclusions: ["events before engagement tracking was switched on are not recorded"], synonyms: [...synonyms],
      v1: async (r) => total(await prisma.engagementEvent.count({ where: { type, occurredAt: between(r) } })),
    }),
  ),
  metric({
    key: "engagement.notifications_sent", name: "Engagement notifications sent", section: "engagement", unit: "COUNT", kind: "PERIOD",
    description: "Reminder and re-engagement notifications created in the period.", formula: "Count of notifications of the engagement types created in the period.", source: "Notification.type, createdAt",
    synonyms: ["engagement notifications", "reminders sent", "notification engagement"],
    v1: async (r) => total(await prisma.notification.count({ where: { type: { in: ENGAGEMENT_NOTIFICATION_TYPES }, createdAt: between(r) } })),
  }),
  metric({
    key: "engagement.notifications_read", name: "Engagement notifications read", section: "engagement", unit: "COUNT", kind: "PERIOD",
    description: "Engagement notifications created in the period that have been read.", formula: "Count of engagement notifications created in the period with a read time.", source: "Notification.readAt",
    exclusions: ["cohort figure: reads can happen later"], liveOnly: true, synonyms: ["notifications read", "read rate"],
    v1: async (r) => total(await prisma.notification.count({ where: { type: { in: ENGAGEMENT_NOTIFICATION_TYPES }, createdAt: between(r), readAt: { not: null } } })),
  }),
  metric({
    key: "engagement.reengagement_response_rate", name: "Re-engagement response rate", section: "engagement", unit: "PERCENT", kind: "PERIOD", isRate: true, liveOnly: true,
    description: "Of re-engagement reminders sent in the period, the share where the person then did the thing asked.", formula: "Reminders sent in the period that were later marked RESPONDED ÷ reminders sent in the period × 100.", source: "EngagementReminder.state",
    exclusions: ["cohort figure"], synonyms: ["re-engagement", "reengagement", "re-engagement rate"],
    v1: async (r) => total(
      await prisma.engagementReminder.count({ where: { sentAt: between(r), state: "RESPONDED" } }),
      await prisma.engagementReminder.count({ where: { sentAt: between(r), state: { in: ["SENT", "RESPONDED", "COMPLETED"] } } }),
    ),
  }),
  metric({
    key: "engagement.referrals_linked", name: "Referrals linked", section: "engagement", unit: "COUNT", kind: "PERIOD",
    description: "Referral relationships created in the period.", formula: "Count of referrals created in the period.", source: "Referral.createdAt",
    synonyms: ["referral activity", "referrals created"],
    v1: async (r) => total(await prisma.referral.count({ where: { createdAt: between(r) } })),
  }),
];

// ---------- marketing ----------
const dayRange = (r: MetricRange) => ({ gte: dayDate(r.fromDay), lte: dayDate(r.toDay) });

async function adSum(r: MetricRange, field: "impressions" | "reach" | "clicks"): Promise<MetricRow[]> {
  const agg = await prisma.marketingMetricDaily.aggregate({ where: { isSandbox: false, date: dayRange(r) }, _sum: { [field]: true } as never });
  return total(Number(((agg as unknown as { _sum: Record<string, number | null> })._sum)[field] ?? 0));
}

export const MARKETING_METRICS: MetricDefinition[] = [
  metric({
    key: "marketing.impressions", name: "Impressions", section: "marketing", unit: "COUNT", kind: "PERIOD",
    description: "Ad impressions reported by the ad provider (sandbox data excluded).", formula: "Sum of provider-reported impressions by date.", source: "MarketingMetricDaily",
    requires: ["marketing:analytics:view"], note: "Provider-reported, kept separate from our own lead and registration numbers.", synonyms: ["impressions"],
    v1: (r) => adSum(r, "impressions"),
  }),
  metric({
    key: "marketing.reach", name: "Reach", section: "marketing", unit: "COUNT", kind: "PERIOD",
    description: "Ad reach reported by the ad provider (sandbox excluded).", formula: "Sum of provider-reported reach by date.", source: "MarketingMetricDaily",
    requires: ["marketing:analytics:view"], note: "Daily reach figures are summed; the same person can be counted on more than one day.", synonyms: ["reach"],
    v1: (r) => adSum(r, "reach"),
  }),
  metric({
    key: "marketing.clicks", name: "Clicks", section: "marketing", unit: "COUNT", kind: "PERIOD",
    description: "Ad clicks reported by the ad provider (sandbox excluded).", formula: "Sum of provider-reported clicks by date.", source: "MarketingMetricDaily",
    requires: ["marketing:analytics:view"], synonyms: ["clicks"],
    v1: (r) => adSum(r, "clicks"),
  }),
  metric({
    key: "marketing.spend", name: "Verified ad spend", section: "marketing", unit: "MINOR_MONEY", kind: "PERIOD",
    description: "Ad spend reported by the provider (sandbox excluded), per currency.", formula: "Sum of provider-reported spend (minor units) by date and campaign currency.", source: "MarketingMetricDaily.spendMinor",
    requires: ["marketing:analytics:view", "marketing:budget:view"], synonyms: ["spend", "ad spend", "marketing spend", "campaign spend"],
    v1: async (r) => {
      const rows = await prisma.$queryRaw<Array<{ currency: string; amount: bigint | null }>>(Prisma.sql`SELECT c."currencyCode" AS currency, SUM(d."spendMinor")::bigint AS amount FROM "MarketingMetricDaily" d JOIN "MarketingCampaign" c ON c.id = d."campaignId" WHERE d."isSandbox" = false AND d."date" >= ${dayDate(r.fromDay)} AND d."date" <= ${dayDate(r.toDay)} GROUP BY 1`);
      return rows.map((x) => ({ dimensionValue: ALL, currency: x.currency, value: Number(x.amount ?? 0), denominator: null }));
    },
  }),
  metric({
    key: "marketing.landing_page_views", name: "Landing page views", section: "marketing", unit: "COUNT", kind: "PERIOD",
    description: "Landing page views recorded in the period.", formula: "Count of marketing events of type LANDING_PAGE_VIEW in the period.", source: "MarketingEvent",
    requires: ["marketing:analytics:view"], synonyms: ["landing page views", "page views", "landing page visits"],
    v1: async (r) => total(await prisma.marketingEvent.count({ where: { type: "LANDING_PAGE_VIEW", occurredAt: between(r) } })),
  }),
  metric({
    key: "marketing.leads", name: "Marketing leads", section: "marketing", unit: "COUNT", kind: "PERIOD",
    description: "Leads captured through campaigns in the period, optionally by channel.", formula: "Count of leads linked to a campaign and captured in the period.", source: "Lead.capturedAt, campaignId",
    dimensions: ["channel", "source"], requires: ["marketing:analytics:view"], synonyms: ["marketing leads", "campaign leads", "leads by channel", "leads by campaign"],
    v1: async (r, _c, dim) => {
      if (dim === "channel") {
        const rows = await prisma.$queryRaw<Array<{ k: string; n: number }>>(Prisma.sql`SELECT c.channel::text AS k, COUNT(l.id)::int AS n FROM "Lead" l JOIN "MarketingCampaign" c ON c.id = l."campaignId" WHERE l."capturedAt" >= ${r.startUtc} AND l."capturedAt" < ${r.endUtc} GROUP BY 1`);
        return rows.map((x) => ({ dimensionValue: x.k, currency: "", value: Number(x.n), denominator: null }));
      }
      if (dim === "source") {
        const rows = await prisma.$queryRaw<Array<{ k: string | null; n: number }>>(Prisma.sql`SELECT l."utmSource" AS k, COUNT(*)::int AS n FROM "Lead" l WHERE l."campaignId" IS NOT NULL AND l."capturedAt" >= ${r.startUtc} AND l."capturedAt" < ${r.endUtc} GROUP BY 1`);
        return rows.map((x) => ({ dimensionValue: x.k ?? "UNKNOWN", currency: "", value: Number(x.n), denominator: null }));
      }
      return total(await prisma.lead.count({ where: { campaignId: { not: null }, capturedAt: between(r) } }));
    },
  }),
  ...(
    [
      ["marketing.registrations", "Marketing registrations", Prisma.sql`l."convertedProfileId" IS NOT NULL`, "registrations from campaigns"],
      ["marketing.profiles_completed", "Marketing profiles completed", Prisma.sql`p."profileCompletion" >= 100`, "profile completion from campaigns"],
      ["marketing.verified", "Marketing verified profiles", Prisma.sql`p.verified`, "verified from campaigns"],
    ] as const
  ).map(([key, name, cond, syn]) =>
    metric({
      key, name, section: "marketing", unit: "COUNT", kind: "PERIOD", liveOnly: true,
      description: `Of leads captured through campaigns in the period, those whose applicant meets: ${name.toLowerCase()} (as of now).`, formula: "Cohort of campaign leads captured in the period joined to their converted profile.", source: "Lead, Profile",
      requires: ["marketing:analytics:view"], exclusions: ["cohort figure", "a marketing conversion is never a match, meeting or marriage outcome"], synonyms: [syn, name.toLowerCase()],
      v1: async (r) => {
        const rows = await prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`SELECT COUNT(*)::int AS n FROM "Lead" l JOIN "Profile" p ON p.id = l."convertedProfileId" WHERE l."campaignId" IS NOT NULL AND l."capturedAt" >= ${r.startUtc} AND l."capturedAt" < ${r.endUtc} AND ${cond}`);
        return total(Number(rows[0]?.n ?? 0));
      },
    }),
  ),
];
