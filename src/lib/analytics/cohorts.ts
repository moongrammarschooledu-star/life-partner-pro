import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { safeRate } from "@/lib/reports/sample-size";
import { suppressSmallGroups } from "@/lib/analytics/access";
import { ACTIVE_OR_BEYOND } from "@/lib/analytics/metrics/helpers";
import { activeEventsOf, getAnalyticsSettings, ACTIVE_DEFINITION_TEXT } from "@/lib/analytics/settings";
import { addDaysKey, dayKey, dayStartUtc } from "@/lib/analytics/time";

// STEP 31 — retention and cohort analysis. Cohorts are computed on demand over indexed columns (and cached for ten minutes), not
// stored: a cohort figure changes as people progress, so a stored copy would silently go stale. Cohort keys are limited to
// registration month, marketing campaign, referral source, membership start month and CRM lifecycle stage — never religion, caste,
// income, health or any other sensitive attribute. Rows below the minimum group size are hidden (with complementary suppression).

export const COHORT_KINDS = ["registration_month", "campaign", "referral_source", "membership_start_month", "lifecycle_stage"] as const;
export type CohortKind = (typeof COHORT_KINDS)[number];

const cache = new Map<string, { at: number; value: unknown }>();
const TTL = 600_000;
export function clearCohortCache(): void {
  cache.clear();
}
async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value as T;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

// ---------------- retention (Day 1/7/30/60/90) ----------------
export const RETENTION_DAYS = [1, 7, 30, 60, 90] as const;
// Day 1 looks at the single day after registration; later horizons look at the 7-day window that starts N days after registration.
export const retentionWindowDays = (n: number) => (n === 1 ? 1 : 7);

export interface RetentionRow { month: string; cohort: number; active: number; rate: number | null }
export interface RetentionResult {
  definition: string;
  windows: Array<{ day: number; windowDays: number; rows: RetentionRow[]; overall: { cohort: number; active: number; rate: number | null } }>;
  note: string;
}

export async function getRetention(opts: { months?: number; now?: Date } = {}): Promise<RetentionResult> {
  const settings = await getAnalyticsSettings();
  const tz = settings.timezone;
  const events = activeEventsOf(settings);
  const now = opts.now ?? new Date();
  const months = Math.min(Math.max(opts.months ?? 6, 1), 24);
  const today = dayKey(now, tz);
  const fromDay = addDaysKey(today, -months * 31);
  const from = dayStartUtc(fromDay, tz);
  return cached(`ret|${tz}|${months}|${today}|${events.join(",")}`, async () => {
    const windows = [];
    for (const n of RETENTION_DAYS) {
      const w = retentionWindowDays(n);
      const cutoff = new Date(now.getTime() - (n + w) * 86_400_000); // only people old enough to have lived the whole window
      const rows = await prisma.$queryRaw<Array<{ m: string; cohort: number; active: number }>>(Prisma.sql`
        SELECT to_char(p."createdAt" AT TIME ZONE ${tz}, 'YYYY-MM') AS m, COUNT(*)::int AS cohort,
          (COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "EngagementEvent" e WHERE e."profileId" = p.id AND e."type"::text = ANY(${events}::text[])
             AND e."occurredAt" >= p."createdAt" + make_interval(days => ${n}) AND e."occurredAt" < p."createdAt" + make_interval(days => ${n + w}))))::int AS active
        FROM "Profile" p WHERE p."softDeleted" = false AND p."createdAt" >= ${from} AND p."createdAt" <= ${cutoff}
        GROUP BY 1 ORDER BY 1`);
      const mapped: RetentionRow[] = rows.map((r) => ({ month: r.m, cohort: Number(r.cohort), active: Number(r.active), rate: safeRate(Number(r.active), Number(r.cohort)) }));
      const cohort = mapped.reduce((s, r) => s + r.cohort, 0);
      const active = mapped.reduce((s, r) => s + r.active, 0);
      windows.push({ day: n, windowDays: w, rows: mapped, overall: { cohort, active, rate: safeRate(active, cohort) } });
    }
    return {
      definition: `${ACTIVE_DEFINITION_TEXT} Day N retention = the share of a registration cohort that was active during the ${"1-day (Day 1) or 7-day (Day 7+)"} window starting N days after registering. Only people old enough to have lived the whole window are counted.`,
      windows,
      note: "Engagement events are recorded only from the day engagement tracking was switched on; earlier registrations show as not active until they act again.",
    };
  });
}

// ---------------- cohorts ----------------
export interface CohortRow {
  key: string; size: number | null; completed: number | null; verified: number | null; activeStatus: number | null; proposalEngaged: number | null; meetingEngaged: number | null; memberNow: number | null; everMember: number | null;
  rates: { completed: number | null; verified: number | null; activeStatus: number | null; proposalEngaged: number | null; meetingEngaged: number | null; membershipRetention: number | null };
  suppressed: boolean;
}

const MEASURES = Prisma.sql`
  COUNT(*)::int AS size,
  (COUNT(*) FILTER (WHERE p."profileCompletion" >= 100))::int AS completed,
  (COUNT(*) FILTER (WHERE p.verified))::int AS verified,
  (COUNT(*) FILTER (WHERE p."status"::text = ANY(${[...ACTIVE_OR_BEYOND]}::text[])))::int AS active_status,
  (COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "ProposalResponse" pr WHERE pr."profileId" = p.id)))::int AS proposal_engaged,
  (COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "Meeting" m JOIN "Proposal" pp ON pp.id = m."proposalId" WHERE pp."profileAId" = p.id OR pp."profileBId" = p.id)))::int AS meeting_engaged,
  (COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "Subscription" s WHERE s."profileId" = p.id)))::int AS ever_member,
  (COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "Subscription" s WHERE s."profileId" = p.id AND s."status"::text IN ('ACTIVE','TRIAL'))))::int AS member_now`;

interface RawCohort { k: string | null; size: number; completed: number; verified: number; active_status: number; proposal_engaged: number; meeting_engaged: number; ever_member: number; member_now: number }

export async function getCohorts(kind: CohortKind, opts: { months?: number; now?: Date } = {}): Promise<{ kind: CohortKind; definition: string; rows: CohortRow[]; minGroupSize: number }> {
  if (!(COHORT_KINDS as readonly string[]).includes(kind)) throw new Error("Unknown cohort kind.");
  const settings = await getAnalyticsSettings();
  const tz = settings.timezone;
  const now = opts.now ?? new Date();
  const months = Math.min(Math.max(opts.months ?? 12, 1), 36);
  const from = dayStartUtc(addDaysKey(dayKey(now, tz), -months * 31), tz);
  const raw = await cached(`coh|${kind}|${tz}|${months}|${dayKey(now, tz)}`, async () => {
    switch (kind) {
      case "registration_month":
        return prisma.$queryRaw<RawCohort[]>(Prisma.sql`SELECT to_char(p."createdAt" AT TIME ZONE ${tz}, 'YYYY-MM') AS k, ${MEASURES} FROM "Profile" p WHERE p."softDeleted" = false AND p."createdAt" >= ${from} GROUP BY 1 ORDER BY 1`);
      case "campaign":
        return prisma.$queryRaw<RawCohort[]>(Prisma.sql`SELECT c.code AS k, ${MEASURES} FROM "Profile" p JOIN "Lead" l ON l."convertedProfileId" = p.id JOIN "MarketingCampaign" c ON c.id = l."campaignId" WHERE p."softDeleted" = false AND p."createdAt" >= ${from} GROUP BY 1 ORDER BY 1`);
      case "referral_source":
        return prisma.$queryRaw<RawCohort[]>(Prisma.sql`SELECT CASE WHEN EXISTS (SELECT 1 FROM "Referral" r WHERE r."refereeProfileId" = p.id) THEN 'REFERRED' ELSE 'NOT_REFERRED' END AS k, ${MEASURES} FROM "Profile" p WHERE p."softDeleted" = false AND p."createdAt" >= ${from} GROUP BY 1 ORDER BY 1`);
      case "membership_start_month":
        return prisma.$queryRaw<RawCohort[]>(Prisma.sql`SELECT to_char(f.first_start AT TIME ZONE ${tz}, 'YYYY-MM') AS k, ${MEASURES} FROM "Profile" p JOIN (SELECT "profileId", MIN("startDate") AS first_start FROM "Subscription" WHERE "startDate" IS NOT NULL GROUP BY 1) f ON f."profileId" = p.id WHERE p."softDeleted" = false AND f.first_start >= ${from} GROUP BY 1 ORDER BY 1`);
      case "lifecycle_stage":
        return prisma.$queryRaw<RawCohort[]>(Prisma.sql`SELECT c."lifecycleStage"::text AS k, ${MEASURES} FROM "Profile" p JOIN "CrmRecord" c ON c."profileId" = p.id WHERE p."softDeleted" = false GROUP BY 1 ORDER BY 1`);
    }
  });
  const shown = suppressSmallGroups(raw.map((r) => ({ dimensionValue: r.k ?? "UNKNOWN", value: Number(r.size), r })), settings.minGroupSize);
  const rows: CohortRow[] = shown.map(({ dimensionValue, suppressed, r }) => {
    if (suppressed) return { key: dimensionValue, size: null, completed: null, verified: null, activeStatus: null, proposalEngaged: null, meetingEngaged: null, memberNow: null, everMember: null, rates: { completed: null, verified: null, activeStatus: null, proposalEngaged: null, meetingEngaged: null, membershipRetention: null }, suppressed: true };
    const size = Number(r.size);
    return {
      key: dimensionValue, size, completed: Number(r.completed), verified: Number(r.verified), activeStatus: Number(r.active_status), proposalEngaged: Number(r.proposal_engaged), meetingEngaged: Number(r.meeting_engaged), memberNow: Number(r.member_now), everMember: Number(r.ever_member),
      rates: { completed: safeRate(Number(r.completed), size), verified: safeRate(Number(r.verified), size), activeStatus: safeRate(Number(r.active_status), size), proposalEngaged: safeRate(Number(r.proposal_engaged), size), meetingEngaged: safeRate(Number(r.meeting_engaged), size), membershipRetention: safeRate(Number(r.member_now), Number(r.ever_member)) },
      suppressed: false,
    };
  });
  return {
    kind, rows, minGroupSize: settings.minGroupSize,
    definition: "Each row is a group of applicants. Rates are shares of the group, as of now. 'Membership retention' = share of the group that ever had a subscription and still has an active or trial one. Groups smaller than the minimum size are hidden.",
  };
}

export async function warmCohorts(): Promise<{ warmed: number }> {
  let n = 0;
  await getRetention();
  n++;
  for (const k of COHORT_KINDS) {
    await getCohorts(k);
    n++;
  }
  return { warmed: n };
}

export async function warmFunnels(): Promise<{ warmed: number }> {
  // funnel stages are live-only metrics; running the standard query once fills the live cache for the dashboards
  const { runAnalyticsQuery } = await import("@/lib/analytics/query");
  const { FUNNEL_ORDER } = await import("@/lib/analytics/metrics/registry");
  await runAnalyticsQuery({ id: "system", permissions: ["analytics:view"] }, { metrics: FUNNEL_ORDER, period: { preset: "LAST_30_DAYS" } }, { resource: "funnel_warm" }).catch(() => undefined);
  return { warmed: FUNNEL_ORDER.length };
}
