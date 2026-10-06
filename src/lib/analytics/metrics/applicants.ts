import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTIVE_OR_BEYOND, ACTIVE_PROFILE_STATUSES, ALL, between, metric, total } from "@/lib/analytics/metrics/helpers";
import type { MetricDefinition, MetricRange } from "@/lib/analytics/types";

// STEP 31 — applicants, the canonical funnel and recorded outcomes. Single definitions: "Verified Applicant" = Profile.verified =
// true on a non-deleted profile (the same flag matching, proposals and badges already read).

const live = { softDeleted: false } as const;

export const APPLICANT_METRICS: MetricDefinition[] = [
  metric({
    key: "applicants.total", name: "Total applicants", section: "executive", unit: "COUNT", kind: "SNAPSHOT",
    description: "All applicant profiles that exist right now.", formula: "Count of profiles that are not deleted.", source: "Profile",
    exclusions: ["soft-deleted profiles"], synonyms: ["total applicants", "all applicants", "how many applicants", "applicants"],
    v1: async () => total(await prisma.profile.count({ where: { ...live } })),
  }),
  metric({
    key: "applicants.new", name: "New applicants", section: "executive", unit: "COUNT", kind: "PERIOD",
    description: "Profiles registered during the period.", formula: "Count of profiles whose registration date is in the period.", source: "Profile.createdAt",
    exclusions: ["soft-deleted profiles"], synonyms: ["new applicants", "registrations", "new registrations", "signups", "new profiles"],
    v1: async (r) => total(await prisma.profile.count({ where: { ...live, createdAt: between(r) } })),
  }),
  metric({
    key: "applicants.verified", name: "Verified applicants", section: "executive", unit: "COUNT", kind: "SNAPSHOT",
    description: "Applicants whose verification is complete right now.", formula: "Count of profiles with verified = true.", source: "Profile.verified",
    exclusions: ["soft-deleted profiles"], synonyms: ["verified applicants", "verified profiles", "verified", "how many verified"],
    note: "Verification is a review process; it is not a guarantee of any outcome.",
    v1: async () => total(await prisma.profile.count({ where: { ...live, verified: true } })),
  }),
  metric({
    key: "applicants.verifications_completed", name: "Verifications completed", section: "verification", unit: "COUNT", kind: "PERIOD",
    description: "Verification records that are in the 'verified' state and were last changed during the period.", formula: "Count of verification records with status VERIFIED whose last update falls in the period.",
    source: "ProfileVerification.updatedAt", exclusions: ["a later edit to an already-verified record moves it into that later period"], synonyms: ["verifications completed", "verified this month", "profiles verified"],
    v1: async (r) => total(await prisma.profileVerification.count({ where: { status: "VERIFIED", updatedAt: between(r) } })),
  }),
  metric({
    key: "applicants.active", name: "Active applicants", section: "executive", unit: "COUNT", kind: "SNAPSHOT",
    description: "Applicants currently in active matchmaking.", formula: "Count of profiles with status ACTIVE, MATCHING, PROPOSAL_SENT, WAITING_FOR_RESPONSE, INTERESTED or MEETING_ARRANGED.",
    source: "Profile.status", exclusions: ["new, under review, closed, suspended, archived or deleted profiles"], synonyms: ["active applicants", "active profiles", "active"],
    v1: async () => total(await prisma.profile.count({ where: { ...live, status: { in: [...ACTIVE_PROFILE_STATUSES] } } })),
  }),
  metric({
    key: "applicants.pending_review", name: "Profiles pending review", section: "operations", unit: "COUNT", kind: "SNAPSHOT",
    description: "Profiles waiting for, or in, first review.", formula: "Count of profiles with status NEW or UNDER_REVIEW.", source: "Profile.status",
    synonyms: ["pending review", "profiles pending review", "review queue", "profile review backlog"],
    v1: async () => total(await prisma.profile.count({ where: { ...live, status: { in: ["NEW", "UNDER_REVIEW"] } } })),
  }),
  metric({
    key: "applicants.active_users", name: "Active users in period", section: "engagement", unit: "COUNT", kind: "PERIOD",
    description: "Distinct applicants who did at least one qualifying platform action during the period.", formula: "Distinct applicants with at least one engagement event of a qualifying type (set in analytics settings) in the period.",
    source: "EngagementEvent", exclusions: ["events before engagement tracking was switched on are not recorded", "system events (a proposal arriving) are not applicant actions"],
    synonyms: ["active users", "monthly active", "daily active", "engaged applicants"],
    v1: async (r, ctx) => {
      const rows = await prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`SELECT COUNT(DISTINCT "profileId")::int AS n FROM "EngagementEvent" WHERE "occurredAt" >= ${r.startUtc} AND "occurredAt" < ${r.endUtc} AND "type"::text = ANY(${ctx.activeEvents}::text[])`);
      return total(Number(rows[0]?.n ?? 0));
    },
  }),
];

// ---------- the canonical funnel (cohort style) ----------
// Each stage = applicants REGISTERED in the period who have, as of now, reached that stage AND every stage before it, so the stages
// nest and a step can never exceed the one before. "Lead" counts leads captured in the period (a separate population).
// Not every applicant is expected to progress to the end; rates between stages are descriptive, not targets.
const proposalSome = (cond: Record<string, unknown>) => ({ OR: [{ proposalsAsA: { some: cond } }, { proposalsAsB: { some: cond } }] });
const REAL_PROPOSAL = { status: { notIn: ["DRAFT", "ARCHIVED"] } };

export const FUNNEL_STAGES: Array<{ key: string; name: string; description: string; formula: string; synonyms: string[]; cond: Record<string, unknown> }> = [
  { key: "funnel.registered", name: "Registered", description: "Applicants who registered in the period.", formula: "Profiles created in the period.", synonyms: ["registered", "registrations"], cond: {} },
  { key: "funnel.profile_completed", name: "Profile completed", description: "Of those registered, profiles that are 100% complete.", formula: "…and profileCompletion = 100.", synonyms: ["profile completed", "completed profiles"], cond: { profileCompletion: { gte: 100 } } },
  { key: "funnel.submitted", name: "Submitted", description: "Of those, profiles that have moved past 'new' into review or beyond.", formula: "…and status is not NEW.", synonyms: ["submitted", "submitted profiles"], cond: { status: { not: "NEW" } } },
  { key: "funnel.verified", name: "Verified", description: "Of those, verified profiles.", formula: "…and verified = true.", synonyms: ["verified"], cond: { verified: true } },
  { key: "funnel.active", name: "Active", description: "Of those, profiles in active matchmaking or further along.", formula: "…and status ACTIVE or beyond.", synonyms: ["active"], cond: { status: { in: [...ACTIVE_OR_BEYOND] } } },
  { key: "funnel.matching", name: "Matching", description: "Of those, profiles that appear in at least one generated match.", formula: "…and has at least one match record.", synonyms: ["matching", "matched"], cond: { OR: [{ matchesAsA: { some: {} } }, { matchesAsB: { some: {} } }] } },
  { key: "funnel.proposal", name: "Proposal", description: "Of those, profiles that are part of at least one proposal.", formula: "…and part of a proposal that is not draft/archived.", synonyms: ["proposal", "proposals"], cond: proposalSome(REAL_PROPOSAL) },
  { key: "funnel.response", name: "Response", description: "Of those, profiles that have responded to a proposal.", formula: "…and has at least one proposal response.", synonyms: ["response", "responded"], cond: { proposalResponses: { some: {} } } },
  { key: "funnel.meeting", name: "Meeting", description: "Of those, profiles whose proposal has a meeting.", formula: "…and a proposal with at least one meeting.", synonyms: ["meeting", "meetings"], cond: proposalSome({ ...REAL_PROPOSAL, meetings: { some: {} } }) },
  { key: "funnel.further_discussion", name: "Further discussion", description: "Of those, profiles whose proposal reached further discussion or beyond.", formula: "…and a proposal in FURTHER_DISCUSSION, ACCEPTED, FINALIZED or MARRIED.", synonyms: ["further discussion"], cond: proposalSome({ status: { in: ["FURTHER_DISCUSSION", "ACCEPTED", "FINALIZED", "MARRIED"] } }) },
  { key: "funnel.finalization", name: "Finalization", description: "Of those, profiles whose proposal was finalized (staff-recorded).", formula: "…and a proposal with a finalized date or status FINALIZED/MARRIED.", synonyms: ["finalization", "finalized"], cond: proposalSome({ OR: [{ finalizedAt: { not: null } }, { status: { in: ["FINALIZED", "MARRIED"] } }] }) },
  { key: "funnel.married", name: "Married (staff-recorded)", description: "Of those, profiles recorded by staff as married.", formula: "…and profile status MARRIED or a proposal with a recorded marriage date.", synonyms: ["married"], cond: { OR: [{ status: "MARRIED" }, ...proposalSome({ marriedAt: { not: null } }).OR] } },
];

function cohortWhere(r: MetricRange, upTo: number): Record<string, unknown> {
  const and = FUNNEL_STAGES.slice(0, upTo + 1).map((s) => s.cond).filter((c) => Object.keys(c).length);
  return { ...live, createdAt: between(r), ...(and.length ? { AND: and } : {}) };
}

export const FUNNEL_METRICS: MetricDefinition[] = [
  metric({
    key: "funnel.leads", name: "Leads captured", section: "executive", unit: "COUNT", kind: "PERIOD",
    description: "Leads captured in the period (a separate population from applicants).", formula: "Count of leads created in the period.", source: "Lead.createdAt",
    exclusions: ["duplicate-flagged leads are still counted here; see CRM analytics for duplicate handling"], synonyms: ["leads", "new leads", "lead volume"],
    v1: async (r) => total(await prisma.lead.count({ where: { createdAt: between(r) } })),
  }),
  ...FUNNEL_STAGES.map((stage, i) =>
    metric({
      key: stage.key, name: stage.name, description: stage.description, section: "executive", unit: "COUNT", kind: "PERIOD", liveOnly: true,
      formula: `Cohort: ${stage.formula}`, source: "Profile + Match + Proposal + ProposalResponse + Meeting",
      exclusions: ["cohort figures change as applicants progress, so they are always computed live and never stored", "not every applicant is expected to reach the next stage"],
      synonyms: stage.synonyms, note: "Cohort of applicants registered in the period.",
      v1: async (r) => total(await prisma.profile.count({ where: cohortWhere(r, i) })),
    }),
  ),
];

// ---------- recorded outcomes (staff-recorded; there is no applicant-reported field) ----------
export const OUTCOME_METRICS: MetricDefinition[] = [
  metric({
    key: "outcomes.finalizations", name: "Finalizations", section: "proposals", unit: "COUNT", kind: "PERIOD",
    description: "Proposals recorded by staff as finalized during the period.", formula: "Count of proposals whose finalized date is in the period.", source: "Proposal.finalizedAt",
    synonyms: ["finalizations", "finalized proposals"], note: "Staff-recorded.",
    v1: async (r) => total(await prisma.proposal.count({ where: { finalizedAt: between(r) } })),
  }),
  metric({
    key: "outcomes.married_recorded", name: "Married (staff-recorded)", section: "executive", unit: "COUNT", kind: "PERIOD",
    description: "Proposals recorded by staff as ending in marriage during the period. There is no applicant-reported marriage field.", formula: "Count of proposals whose marriage date is in the period.", source: "Proposal.marriedAt",
    exclusions: ["marriages that were never recorded by staff"], synonyms: ["married", "marriages", "reported married", "marriage"], note: "Staff-recorded; descriptive only, never a target or a prediction.",
    v1: async (r) => total(await prisma.proposal.count({ where: { marriedAt: between(r) } })),
  }),
  metric({
    key: "outcomes.finalization_reviews", name: "Finalization reviews", section: "executive", unit: "COUNT", kind: "SNAPSHOT",
    description: "Applicants currently in the finalization-review lifecycle stage.", formula: "Count of CRM records in stage FINALIZATION_REVIEW.", source: "CrmRecord.lifecycleStage",
    synonyms: ["finalization reviews", "finalization review"],
    v1: async () => total(await prisma.crmRecord.count({ where: { lifecycleStage: "FINALIZATION_REVIEW" } })),
  }),
];

export { ALL };
