// Mirrors, without modifying, the inline `sumStatuses()` closure in
// src/app/api/admin/dashboard/route.ts — the ProposalStatus enum mixes an
// older 8-value lifecycle with STEP 7's 22-stage one, and both sets of
// values can appear in live data. Keeping these groupings in one shared,
// tested place means Reports' proposal numbers always agree with the
// Dashboard's for the same underlying data, without touching that working
// route.
export const PROPOSAL_STATUS_GROUPS = {
  pendingResponses: ["DRAFT", "PROPOSAL_CREATED", "WAITING_FOR_PROFILE_A", "WAITING_FOR_PROFILE_B", "BOTH_REVIEWING", "SENT", "WAITING"],
  mutualInterest: ["BOTH_INTERESTED", "INTERESTED"],
  contactPending: ["CONTACT_PERMISSION_PENDING"],
  accepted: ["ACCEPTED"],
  finalized: ["FINALIZED"],
  married: ["MARRIED"],
  rejected: ["REJECTED", "NOT_INTERESTED"],
  onHold: ["ON_HOLD"],
  closed: ["CLOSED"],
  archived: ["ARCHIVED"],
} as const;

export type ProposalStatusGroupKey = keyof typeof PROPOSAL_STATUS_GROUPS;

// Pure — `countByStatus` is the plain object built from a Prisma
// `proposal.groupBy({by:["status"]})` result.
export function sumProposalStatuses(countByStatus: Record<string, number>, groupKey: ProposalStatusGroupKey): number {
  return PROPOSAL_STATUS_GROUPS[groupKey].reduce((sum, status) => sum + (countByStatus[status] ?? 0), 0);
}
