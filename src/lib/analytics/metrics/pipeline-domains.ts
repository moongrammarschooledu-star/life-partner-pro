import { Prisma, type ProposalStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ALL, between, countOrGroup, metric, total } from "@/lib/analytics/metrics/helpers";
import type { MetricDefinition, MetricRow } from "@/lib/analytics/types";

// STEP 31 — CRM, matching, proposals, meetings, family portal and support metrics. Wording is deliberately neutral: a match score is
// shown only as a distribution of matches, never as a probability of anything and never per person.

async function durationRows(sql: Prisma.Sql): Promise<MetricRow[]> {
  const rows = await prisma.$queryRaw<Array<{ minutes: bigint | number | null; n: bigint | number }>>(sql);
  return total(Number(rows[0]?.minutes ?? 0), Number(rows[0]?.n ?? 0));
}
async function rateRows(sql: Prisma.Sql): Promise<MetricRow[]> {
  const rows = await prisma.$queryRaw<Array<{ ok: bigint | number; n: bigint | number }>>(sql);
  return total(Number(rows[0]?.ok ?? 0), Number(rows[0]?.n ?? 0));
}

const REAL_PROPOSAL = { status: { notIn: ["DRAFT", "ARCHIVED"] as ProposalStatus[] } };
const OPEN_PROPOSAL_EXCLUDED = ["DRAFT", "CLOSED", "ARCHIVED", "REJECTED", "MARRIED", "NOT_INTERESTED", "FINALIZED"];

export const CRM_METRICS: MetricDefinition[] = [
  metric({
    key: "crm.leads", name: "Leads", section: "crm", unit: "COUNT", kind: "PERIOD",
    description: "Leads captured in the period, optionally by source or status.", formula: "Count of leads created in the period.", source: "Lead.createdAt",
    dimensions: ["source", "status"], synonyms: ["leads by source", "lead sources", "leads by status", "crm leads"],
    v1: (r, _c, dim) => countOrGroup(prisma.lead as never, { createdAt: between(r) }, dim, dim === "source" ? "source" : dim === "status" ? "status" : undefined),
  }),
  metric({
    key: "crm.leads_converted", name: "Leads converted", section: "crm", unit: "COUNT", kind: "PERIOD",
    description: "Leads that became applicant profiles during the period.", formula: "Count of leads whose conversion time is in the period.", source: "Lead.convertedAt",
    synonyms: ["leads converted", "converted leads", "lead conversions"],
    v1: async (r) => total(await prisma.lead.count({ where: { convertedAt: between(r) } })),
  }),
  metric({
    key: "crm.lead_conversion_rate", name: "Lead conversion rate", section: "crm", unit: "PERCENT", kind: "PERIOD", isRate: true, liveOnly: true,
    description: "Of the leads captured in the period, the share that have become applicant profiles (as of now).", formula: "Leads created in the period that are converted ÷ leads created in the period × 100.", source: "Lead.convertedProfileId",
    exclusions: ["cohort figure: changes as leads convert later"], synonyms: ["lead conversion rate", "lead conversion", "conversion rate"],
    v1: async (r) => total(await prisma.lead.count({ where: { createdAt: between(r), convertedProfileId: { not: null } } }), await prisma.lead.count({ where: { createdAt: between(r) } })),
  }),
  metric({
    key: "crm.duplicate_leads", name: "Duplicate leads", section: "crm", unit: "COUNT", kind: "PERIOD",
    description: "Leads in the period that were marked as duplicates.", formula: "Count of leads created in the period with status DUPLICATE or a duplicate-of link.", source: "Lead.status, duplicateOfLeadId",
    synonyms: ["duplicate leads", "duplicates"],
    v1: async (r) => total(await prisma.lead.count({ where: { createdAt: between(r), OR: [{ status: "DUPLICATE" }, { duplicateOfLeadId: { not: null } }] } })),
  }),
  metric({
    key: "crm.lifecycle", name: "Applicants by lifecycle stage", section: "crm", unit: "COUNT", kind: "SNAPSHOT",
    description: "CRM records grouped by their current lifecycle stage.", formula: "Count of CRM records grouped by lifecycleStage.", source: "CrmRecord.lifecycleStage",
    dimensions: ["stage"], synonyms: ["lifecycle", "lifecycle stage", "applicant lifecycle", "crm stages", "stages"],
    v1: (_r, _c, dim) => countOrGroup(prisma.crmRecord as never, {}, dim, dim === "stage" ? "lifecycleStage" : undefined),
  }),
  metric({
    key: "crm.stage_transitions", name: "Lifecycle stage changes", section: "crm", unit: "COUNT", kind: "PERIOD",
    description: "Lifecycle stage changes recorded in the period, optionally by the stage moved into.", formula: "Count of lifecycle-history rows created in the period.", source: "CrmLifecycleHistory",
    dimensions: ["to_stage"], synonyms: ["stage changes", "stage transitions", "lifecycle changes"],
    v1: (r, _c, dim) => countOrGroup(prisma.crmLifecycleHistory as never, { createdAt: between(r) }, dim, dim === "to_stage" ? "toStage" : undefined),
  }),
  metric({
    key: "crm.assignment", name: "CRM records by assigned staff", section: "crm", unit: "COUNT", kind: "SNAPSHOT",
    description: "CRM records grouped by the staff member they are assigned to (workload distribution).", formula: "Count of CRM records grouped by assigned staff member.", source: "CrmRecord.assignedStaffId",
    dimensions: ["assigned_staff"], requires: ["analytics:staff:view"], synonyms: ["crm workload", "assignment distribution", "crm assignment"],
    v1: (_r, _c, dim) => countOrGroup(prisma.crmRecord as never, {}, dim, dim === "assigned_staff" ? "assignedStaffId" : undefined),
  }),
];

export const MATCHING_METRICS: MetricDefinition[] = [
  metric({
    key: "matching.open_matches", name: "Active matches", section: "executive", unit: "COUNT", kind: "SNAPSHOT",
    description: "Match records that a person is still working with (suggested, reviewed or approved).", formula: "Count of matches with status SUGGESTED, REVIEWED or APPROVED.", source: "Match.status",
    synonyms: ["active matches", "open matches"],
    v1: async () => total(await prisma.match.count({ where: { status: { in: ["SUGGESTED", "REVIEWED", "APPROVED"] } } })),
  }),
  metric({
    key: "matching.matches_generated", name: "Matches generated", section: "matching", unit: "COUNT", kind: "PERIOD",
    description: "Match records generated during the period.", formula: "Count of match records created in the period.", source: "Match.createdAt",
    synonyms: ["matches generated", "matches", "new matches"],
    v1: async (r) => total(await prisma.match.count({ where: { createdAt: between(r) } })),
  }),
  metric({
    key: "matching.by_status", name: "Matches by review status", section: "matching", unit: "COUNT", kind: "PERIOD", liveOnly: true,
    description: "Of the matches generated in the period, how many are in each review status now.", formula: "Count of matches created in the period, grouped by current status.", source: "Match.status",
    dimensions: ["status"], exclusions: ["cohort figure: changes as matches are reviewed"], synonyms: ["matches by status", "matches reviewed", "admin reviewed matches"],
    v1: (r, _c, dim) => countOrGroup(prisma.match as never, { createdAt: between(r) }, dim, dim === "status" ? "status" : undefined),
  }),
  metric({
    key: "matching.review_rate", name: "Match review rate", section: "matching", unit: "PERCENT", kind: "PERIOD", isRate: true, liveOnly: true,
    description: "Of the matches generated in the period, the share a person has reviewed.", formula: "Matches created in the period that are no longer 'suggested' ÷ matches created in the period × 100.", source: "Match.status",
    exclusions: ["cohort figure"], synonyms: ["match review rate", "review rate"],
    v1: async (r) => total(await prisma.match.count({ where: { createdAt: between(r), status: { not: "SUGGESTED" } } }), await prisma.match.count({ where: { createdAt: between(r) } })),
  }),
  metric({
    key: "matching.proposal_rate", name: "Match proposal rate", section: "matching", unit: "PERCENT", kind: "PERIOD", isRate: true, liveOnly: true,
    description: "Of the matches generated in the period, the share that led to a proposal.", formula: "Matches created in the period with status PROPOSAL_CREATED ÷ matches created in the period × 100.", source: "Match.status",
    exclusions: ["cohort figure"], note: "A proposal is a staff decision step; this is not a measure of the quality of any match.", synonyms: ["match proposal rate", "proposal rate", "matches to proposals"],
    v1: async (r) => total(await prisma.match.count({ where: { createdAt: between(r), status: "PROPOSAL_CREATED" } }), await prisma.match.count({ where: { createdAt: between(r) } })),
  }),
  metric({
    key: "matching.score_distribution", name: "Match score distribution", section: "matching", unit: "COUNT", kind: "PERIOD", liveOnly: true,
    description: "How the matches generated in the period spread across five score bands. A score is a rule-based comparison of stated preferences, not a probability of any outcome.", formula: "Count of matches created in the period, grouped into score bands 0–19, 20–39, 40–59, 60–79 and 80–100.", source: "Match.score",
    dimensions: ["score_band"], note: "Never a probability of marriage, success, worth or attractiveness; never shown per person.", synonyms: ["score distribution", "match score distribution", "match scores"],
    v1: async (r, _c, dim) => {
      if (dim === ALL) return total(await prisma.match.count({ where: { createdAt: between(r) } }));
      const rows = await prisma.$queryRaw<Array<{ band: string; n: number }>>(Prisma.sql`SELECT CASE WHEN "score" >= 80 THEN '80-100' WHEN "score" >= 60 THEN '60-79' WHEN "score" >= 40 THEN '40-59' WHEN "score" >= 20 THEN '20-39' ELSE '0-19' END AS band, COUNT(*)::int AS n FROM "Match" WHERE "createdAt" >= ${r.startUtc} AND "createdAt" < ${r.endUtc} GROUP BY 1`);
      return rows.map((x) => ({ dimensionValue: x.band, currency: "", value: Number(x.n), denominator: null }));
    },
  }),
];

export const PROPOSAL_METRICS: MetricDefinition[] = [
  metric({
    key: "proposals.created", name: "Proposals created", section: "proposals", unit: "COUNT", kind: "PERIOD",
    description: "Proposals created during the period.", formula: "Count of proposals created in the period (drafts and archived excluded).", source: "Proposal.createdAt",
    exclusions: ["draft and archived proposals"], synonyms: ["proposals created", "new proposals", "proposals"],
    v1: async (r) => total(await prisma.proposal.count({ where: { createdAt: between(r), ...REAL_PROPOSAL } })),
  }),
  metric({
    key: "proposals.active", name: "Active proposals", section: "executive", unit: "COUNT", kind: "SNAPSHOT",
    description: "Proposals that are still open.", formula: "Count of proposals not draft, closed, archived, rejected, finalized, married or not-interested.", source: "Proposal.status",
    synonyms: ["active proposals", "open proposals"],
    v1: async () => total(await prisma.proposal.count({ where: { status: { notIn: OPEN_PROPOSAL_EXCLUDED as never } } })),
  }),
  metric({
    key: "proposals.pending_responses", name: "Pending responses", section: "executive", unit: "COUNT", kind: "SNAPSHOT",
    description: "Proposals waiting for one or both sides to respond.", formula: "Count of proposals in WAITING_FOR_PROFILE_A, WAITING_FOR_PROFILE_B or BOTH_REVIEWING.", source: "Proposal.status",
    synonyms: ["pending responses", "awaiting response", "waiting for response", "proposals pending"],
    v1: async () => total(await prisma.proposal.count({ where: { status: { in: ["WAITING_FOR_PROFILE_A", "WAITING_FOR_PROFILE_B", "BOTH_REVIEWING"] } } })),
  }),
  metric({
    key: "proposals.responses", name: "Proposal responses", section: "proposals", unit: "COUNT", kind: "PERIOD",
    description: "Responses given by applicants during the period, optionally by type.", formula: "Count of proposal responses given in the period.", source: "ProposalResponse.respondedAt",
    dimensions: ["response"], synonyms: ["responses", "proposal responses", "interested", "not interested", "more information"],
    v1: (r, _c, dim) => countOrGroup(prisma.proposalResponse as never, { respondedAt: between(r) }, dim, dim === "response" ? "response" : undefined),
  }),
  metric({
    key: "proposals.response_rate", name: "Proposal response rate", section: "proposals", unit: "PERCENT", kind: "PERIOD", isRate: true, liveOnly: true,
    description: "Of the proposals created in the period, the share that have received at least one response.", formula: "Proposals created in the period with at least one response ÷ proposals created in the period × 100.", source: "Proposal, ProposalResponse",
    exclusions: ["cohort figure"], synonyms: ["response rate", "proposal response rate"],
    v1: async (r) => total(await prisma.proposal.count({ where: { createdAt: between(r), ...REAL_PROPOSAL, responses: { some: {} } } }), await prisma.proposal.count({ where: { createdAt: between(r), ...REAL_PROPOSAL } })),
  }),
  metric({
    key: "proposals.mutual_interest_rate", name: "Mutual interest rate", section: "proposals", unit: "PERCENT", kind: "PERIOD", isRate: true, liveOnly: true,
    description: "Of the proposals created in the period, the share where both sides expressed interest.", formula: "Proposals created in the period that reached BOTH_INTERESTED ÷ proposals created in the period × 100.", source: "Proposal, ProposalEvent",
    exclusions: ["cohort figure"], note: "Descriptive only; not a prediction for any proposal.", synonyms: ["mutual interest rate", "mutual interest"],
    v1: async (r) => total(await prisma.proposal.count({ where: { createdAt: between(r), ...REAL_PROPOSAL, events: { some: { status: "BOTH_INTERESTED" } } } }), await prisma.proposal.count({ where: { createdAt: between(r), ...REAL_PROPOSAL } })),
  }),
  metric({
    key: "proposals.contact_requests", name: "Contact permission requests", section: "proposals", unit: "COUNT", kind: "PERIOD",
    description: "Contact-permission requests made during the period.", formula: "Count of contact permissions requested in the period.", source: "ContactPermission.requestedAt",
    synonyms: ["contact requests", "contact permission requests"],
    v1: async (r) => total(await prisma.contactPermission.count({ where: { requestedAt: between(r) } })),
  }),
  metric({
    key: "proposals.contact_approvals", name: "Contact approvals", section: "proposals", unit: "COUNT", kind: "PERIOD",
    description: "Contact permissions approved during the period.", formula: "Count of contact permissions approved in the period.", source: "ContactPermission.approvedAt",
    synonyms: ["contact approvals", "contact approved"],
    v1: async (r) => total(await prisma.contactPermission.count({ where: { approvedAt: between(r) } })),
  }),
];

export const MEETING_METRICS: MetricDefinition[] = [
  metric({
    key: "meetings.requested", name: "Meetings requested", section: "meetings", unit: "COUNT", kind: "PERIOD",
    description: "Meeting records created during the period.", formula: "Count of meetings created in the period.", source: "Meeting.createdAt",
    synonyms: ["meetings requested", "meeting requests", "meetings created"],
    v1: async (r) => total(await prisma.meeting.count({ where: { createdAt: between(r) } })),
  }),
  metric({
    key: "meetings.status_changes", name: "Meetings by status", section: "meetings", unit: "COUNT", kind: "PERIOD",
    description: "Meetings whose status last changed in the period, grouped by their current status (scheduled, completed, cancelled, rescheduled, …).", formula: "Count of meetings last updated in the period, grouped by status.", source: "Meeting.status, updatedAt",
    dimensions: ["status"], exclusions: ["a later update moves a meeting into that later period"], synonyms: ["meetings scheduled", "meetings completed", "meetings cancelled", "meetings rescheduled", "meetings"],
    v1: (r, _c, dim) => countOrGroup(prisma.meeting as never, { updatedAt: between(r) }, dim, dim === "status" ? "status" : undefined),
  }),
  metric({
    key: "meetings.scheduled_now", name: "Meetings scheduled", section: "executive", unit: "COUNT", kind: "SNAPSHOT",
    description: "Meetings that are currently scheduled or confirmed.", formula: "Count of meetings with status SCHEDULED or CONFIRMED.", source: "Meeting.status",
    synonyms: ["meetings scheduled now", "upcoming meetings", "scheduled meetings"],
    v1: async () => total(await prisma.meeting.count({ where: { status: { in: ["SCHEDULED", "CONFIRMED"] } } })),
  }),
  metric({
    key: "meetings.completed_period", name: "Meetings completed", section: "executive", unit: "COUNT", kind: "PERIOD",
    description: "Meetings marked completed during the period.", formula: "Count of meetings with status COMPLETED last updated in the period.", source: "Meeting.status, updatedAt",
    note: "Counts completion only; nothing is inferred about how a meeting went.", synonyms: ["meetings completed", "completed meetings"],
    v1: async (r) => total(await prisma.meeting.count({ where: { status: "COMPLETED", updatedAt: between(r) } })),
  }),
  metric({
    key: "meetings.pending_confirmation", name: "Meetings pending confirmation", section: "meetings", unit: "COUNT", kind: "SNAPSHOT",
    description: "Meetings waiting to be confirmed.", formula: "Count of meetings with status REQUESTED.", source: "Meeting.status",
    synonyms: ["pending confirmation", "meetings pending", "unconfirmed meetings"],
    v1: async () => total(await prisma.meeting.count({ where: { status: "REQUESTED" } })),
  }),
];

export const FAMILY_METRICS: MetricDefinition[] = [
  metric({
    key: "family.invitations", name: "Family invitations sent", section: "family", unit: "COUNT", kind: "PERIOD",
    description: "Family invitations created during the period (aggregate counts only).", formula: "Count of family invitations created in the period.", source: "FamilyInvitation.createdAt",
    dimensions: ["status"], requires: ["analytics:sensitive:view"], exclusions: ["no names, contact details or comments"], synonyms: ["family invitations", "invitations sent"],
    v1: (r, _c, dim) => countOrGroup(prisma.familyInvitation as never, { createdAt: between(r) }, dim, dim === "status" ? "status" : undefined),
  }),
  metric({
    key: "family.invitations_accepted", name: "Family invitations accepted", section: "family", unit: "COUNT", kind: "PERIOD",
    description: "Family invitations accepted during the period.", formula: "Count of family invitations whose acceptance time is in the period.", source: "FamilyInvitation.acceptedAt",
    requires: ["analytics:sensitive:view"], synonyms: ["invitations accepted", "family accepted"],
    v1: async (r) => total(await prisma.familyInvitation.count({ where: { acceptedAt: between(r) } })),
  }),
  metric({
    key: "family.active_members", name: "Active family members", section: "family", unit: "COUNT", kind: "SNAPSHOT",
    description: "Family members with an active account.", formula: "Count of family members with status ACTIVE.", source: "FamilyMember.status",
    requires: ["analytics:sensitive:view"], synonyms: ["active family members", "family members", "family participation"],
    v1: async () => total(await prisma.familyMember.count({ where: { status: "ACTIVE" } })),
  }),
  metric({
    key: "family.shared_records", name: "Records shared with family", section: "family", unit: "COUNT", kind: "SNAPSHOT",
    description: "Active shares of proposals and meetings with family members, by record type.", formula: "Count of active family shares grouped by record type.", source: "FamilySharedRecord",
    dimensions: ["record_type"], requires: ["analytics:sensitive:view"], synonyms: ["proposal shares", "family shares", "shared with family"],
    v1: (_r, _c, dim) => countOrGroup(prisma.familySharedRecord as never, { status: "ACTIVE" }, dim, dim === "record_type" ? "recordType" : undefined),
  }),
  metric({
    key: "family.decisions", name: "Family responses", section: "family", unit: "COUNT", kind: "PERIOD",
    description: "Responses recorded by family members during the period (counts only; comments are never included).", formula: "Count of family decisions created in the period.", source: "FamilyDecision.createdAt",
    dimensions: ["decision"], requires: ["analytics:sensitive:view"], exclusions: ["private family comments"], synonyms: ["family responses", "family decisions"],
    v1: (r, _c, dim) => countOrGroup(prisma.familyDecision as never, { createdAt: between(r) }, dim, dim === "decision" ? "decision" : undefined),
  }),
];

export const SUPPORT_METRICS: MetricDefinition[] = [
  metric({
    key: "support.opened", name: "Cases opened", section: "support", unit: "COUNT", kind: "PERIOD",
    description: "Cases opened during the period.", formula: "Count of cases created in the period.", source: "Case.createdAt",
    dimensions: ["category", "priority", "type"], synonyms: ["cases opened", "new cases", "support cases", "new support cases"],
    v1: (r, _c, dim) => countOrGroup(prisma.case as never, { createdAt: between(r) }, dim, dim === "category" ? "category" : dim === "priority" ? "priority" : dim === "type" ? "type" : undefined),
  }),
  metric({
    key: "support.open", name: "Open cases", section: "executive", unit: "COUNT", kind: "SNAPSHOT",
    description: "Cases that are not resolved, closed or archived.", formula: "Count of cases whose status is not RESOLVED, CLOSED or ARCHIVED.", source: "Case.status",
    dimensions: ["priority", "category", "status"], synonyms: ["open cases", "support backlog", "open support cases"],
    v1: (_r, _c, dim) => countOrGroup(prisma.case as never, { status: { notIn: ["RESOLVED", "CLOSED", "ARCHIVED"] } }, dim, dim === "priority" ? "priority" : dim === "category" ? "category" : dim === "status" ? "status" : undefined),
  }),
  metric({
    key: "support.resolved", name: "Cases resolved", section: "support", unit: "COUNT", kind: "PERIOD",
    description: "Cases moved to resolved during the period.", formula: "Count of status changes to RESOLVED recorded in the period.", source: "CaseStatusHistory",
    synonyms: ["cases resolved", "resolved cases"],
    v1: async (r) => total(await prisma.caseStatusHistory.count({ where: { toStatus: "RESOLVED", createdAt: between(r) } })),
  }),
  metric({
    key: "support.reopened", name: "Cases reopened", section: "support", unit: "COUNT", kind: "PERIOD",
    description: "Cases reopened during the period.", formula: "Count of status changes to REOPENED recorded in the period.", source: "CaseStatusHistory",
    synonyms: ["reopened cases", "cases reopened"],
    v1: async (r) => total(await prisma.caseStatusHistory.count({ where: { toStatus: "REOPENED", createdAt: between(r) } })),
  }),
  metric({
    key: "support.escalations", name: "Case escalations", section: "support", unit: "COUNT", kind: "PERIOD",
    description: "Cases escalated during the period.", formula: "Count of status changes to ESCALATED recorded in the period.", source: "CaseStatusHistory",
    synonyms: ["escalations", "escalated cases", "escalation"],
    v1: async (r) => total(await prisma.caseStatusHistory.count({ where: { toStatus: "ESCALATED", createdAt: between(r) } })),
  }),
  metric({
    key: "support.first_response_sla", name: "First-response SLA compliance", section: "support", unit: "PERCENT", kind: "PERIOD", isRate: true,
    description: "Share of cases opened in the period that got a first response on or before the target time.", formula: "Cases created in the period responded to by the first-response due time ÷ cases created in the period that have a first-response due time × 100.", source: "Case.firstRespondedAt, firstResponseDueAt",
    exclusions: ["cases without a first-response target"], synonyms: ["first response sla", "support sla", "sla performance", "sla compliance"],
    v1: (r) => rateRows(Prisma.sql`SELECT (COUNT(*) FILTER (WHERE "firstRespondedAt" IS NOT NULL AND "firstRespondedAt" <= "firstResponseDueAt"))::int AS ok, COUNT(*)::int AS n FROM "Case" WHERE "createdAt" >= ${r.startUtc} AND "createdAt" < ${r.endUtc} AND "firstResponseDueAt" IS NOT NULL`),
  }),
  metric({
    key: "support.resolution_sla", name: "Resolution SLA compliance", section: "support", unit: "PERCENT", kind: "PERIOD", isRate: true,
    description: "Share of cases closed in the period that were closed on or before their resolution target.", formula: "Cases closed in the period on/before the resolution due time ÷ cases closed in the period that have a resolution due time × 100.", source: "Case.closedAt, resolutionDueAt",
    exclusions: ["cases without a resolution target"], synonyms: ["resolution sla"],
    v1: (r) => rateRows(Prisma.sql`SELECT (COUNT(*) FILTER (WHERE "closedAt" <= "resolutionDueAt"))::int AS ok, COUNT(*)::int AS n FROM "Case" WHERE "closedAt" >= ${r.startUtc} AND "closedAt" < ${r.endUtc} AND "resolutionDueAt" IS NOT NULL`),
  }),
  metric({
    key: "support.avg_first_response_hours", name: "Average first-response time", section: "support", unit: "HOURS", kind: "PERIOD", isDuration: true,
    description: "Average time to first response for cases opened in the period that have had one.", formula: "Average of (first response − created) for cases created in the period with a first response.", source: "Case.createdAt, firstRespondedAt",
    synonyms: ["response time", "first response time", "average response time"],
    v1: (r) => durationRows(Prisma.sql`SELECT COALESCE(SUM(EXTRACT(EPOCH FROM ("firstRespondedAt" - "createdAt")) / 60), 0)::bigint AS minutes, COUNT(*)::int AS n FROM "Case" WHERE "createdAt" >= ${r.startUtc} AND "createdAt" < ${r.endUtc} AND "firstRespondedAt" IS NOT NULL`),
  }),
  metric({
    key: "support.avg_resolution_hours", name: "Average resolution time", section: "support", unit: "HOURS", kind: "PERIOD", isDuration: true,
    description: "Average time from opening to closing for cases closed in the period.", formula: "Average of (closed − created) for cases closed in the period.", source: "Case.createdAt, closedAt",
    synonyms: ["resolution time", "average resolution time"],
    v1: (r) => durationRows(Prisma.sql`SELECT COALESCE(SUM(EXTRACT(EPOCH FROM ("closedAt" - "createdAt")) / 60), 0)::bigint AS minutes, COUNT(*)::int AS n FROM "Case" WHERE "closedAt" >= ${r.startUtc} AND "closedAt" < ${r.endUtc}`),
  }),
  metric({
    key: "support.escalation_rate", name: "Escalation rate", section: "support", unit: "PERCENT", kind: "PERIOD", isRate: true, liveOnly: true,
    description: "Share of cases opened in the period that have been escalated beyond the first level.", formula: "Cases created in the period with escalation level above 1 ÷ cases created in the period × 100.", source: "Case.escalationLevel",
    exclusions: ["cohort figure"], synonyms: ["escalation rate"],
    v1: async (r) => total(await prisma.case.count({ where: { createdAt: between(r), escalationLevel: { gt: 1 } } }), await prisma.case.count({ where: { createdAt: between(r) } })),
  }),
];
