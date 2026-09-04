import type { ProposalStatus } from "@prisma/client";

// Pre-STEP7 values, kept only so old rows stay valid — never offered as a
// target status by any new UI, excluded from STATUS_GROUPS below.
export const LEGACY_STATUSES: ProposalStatus[] = ["SENT", "INTERESTED", "NOT_INTERESTED", "WAITING", "MEETING"];

export function isLegacyStatus(status: ProposalStatus): boolean {
  return LEGACY_STATUSES.includes(status);
}

// Typed as a full Record (not Partial) so forgetting a new enum value here
// is a compile error rather than a silent runtime gap.
export const ADMIN_STATUS_LABEL: Record<ProposalStatus, string> = {
  DRAFT: "Draft",
  SENT: "Sent (legacy)",
  INTERESTED: "Interested (legacy)",
  NOT_INTERESTED: "Not Interested (legacy)",
  WAITING: "Waiting (legacy)",
  MEETING: "Meeting (legacy)",
  FINALIZED: "Finalized",
  CLOSED: "Closed",
  PROPOSAL_CREATED: "Proposal Created",
  WAITING_FOR_PROFILE_A: "Waiting for Profile A",
  WAITING_FOR_PROFILE_B: "Waiting for Profile B",
  BOTH_REVIEWING: "Both Reviewing",
  PROFILE_A_INTERESTED: "Profile A Interested",
  PROFILE_B_INTERESTED: "Profile B Interested",
  BOTH_INTERESTED: "Both Interested",
  CONTACT_PERMISSION_PENDING: "Contact Permission Pending",
  CONTACT_APPROVED: "Contact Approved",
  FAMILIES_CONTACTED: "Families Contacted",
  MEETING_REQUESTED: "Meeting Requested",
  MEETING_SCHEDULED: "Meeting Scheduled",
  MEETING_COMPLETED: "Meeting Completed",
  FURTHER_DISCUSSION: "Further Discussion",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  ON_HOLD: "On Hold",
  MARRIED: "Married",
  ARCHIVED: "Archived",
};

// Deliberately shorter/gentler phrasing for the applicant-facing screen —
// e.g. never say "Contact Permission Pending", say something a family
// reading it at home would understand at a glance.
export const APPLICANT_STATUS_LABEL: Record<ProposalStatus, string> = {
  DRAFT: "Being Prepared",
  SENT: "Under Review",
  INTERESTED: "Under Review",
  NOT_INTERESTED: "Closed",
  WAITING: "Under Review",
  MEETING: "Meeting in Progress",
  FINALIZED: "Finalized",
  CLOSED: "Closed",
  PROPOSAL_CREATED: "New Proposal — Awaiting Your Response",
  WAITING_FOR_PROFILE_A: "Awaiting Response",
  WAITING_FOR_PROFILE_B: "Awaiting Response",
  BOTH_REVIEWING: "Both Sides Reviewing",
  PROFILE_A_INTERESTED: "Interest Recorded",
  PROFILE_B_INTERESTED: "Interest Recorded",
  BOTH_INTERESTED: "Mutual Interest — Admin Reviewing",
  CONTACT_PERMISSION_PENDING: "Awaiting Contact Permission",
  CONTACT_APPROVED: "Contact Details Shared",
  FAMILIES_CONTACTED: "Families in Discussion",
  MEETING_REQUESTED: "Meeting Requested",
  MEETING_SCHEDULED: "Meeting Scheduled",
  MEETING_COMPLETED: "Meeting Completed",
  FURTHER_DISCUSSION: "In Further Discussion",
  ACCEPTED: "Accepted by Both Sides",
  REJECTED: "Not Proceeding",
  ON_HOLD: "On Hold",
  MARRIED: "Married",
  ARCHIVED: "Closed",
};

export interface StatusGroup {
  key: string;
  label: string;
  statuses: ProposalStatus[];
}

// Groups the 26 raw values into usable Tabs/filter buckets — a flat list of
// every status is unusable as a tab bar (spec §23's filter list implies
// something coarser than the raw 22-value enum for browsing).
export const STATUS_GROUPS: StatusGroup[] = [
  { key: "setup", label: "Setup", statuses: ["DRAFT", "PROPOSAL_CREATED"] },
  {
    key: "awaiting_response",
    label: "Awaiting Response",
    statuses: ["WAITING_FOR_PROFILE_A", "WAITING_FOR_PROFILE_B", "BOTH_REVIEWING", "PROFILE_A_INTERESTED", "PROFILE_B_INTERESTED"],
  },
  { key: "mutual_interest", label: "Mutual Interest", statuses: ["BOTH_INTERESTED"] },
  {
    key: "contact_meeting",
    label: "Contact & Meeting",
    statuses: [
      "CONTACT_PERMISSION_PENDING",
      "CONTACT_APPROVED",
      "FAMILIES_CONTACTED",
      "MEETING_REQUESTED",
      "MEETING_SCHEDULED",
      "MEETING_COMPLETED",
    ],
  },
  { key: "discussion", label: "Discussion", statuses: ["FURTHER_DISCUSSION", "ON_HOLD"] },
  { key: "outcome", label: "Outcome", statuses: ["ACCEPTED", "FINALIZED", "MARRIED", "REJECTED", "CLOSED", "ARCHIVED"] },
  { key: "legacy", label: "Legacy", statuses: LEGACY_STATUSES },
];

export function statusGroupOf(status: ProposalStatus): StatusGroup | undefined {
  return STATUS_GROUPS.find((g) => g.statuses.includes(status));
}

// The ordered set of statuses offered as a new target in "Change Status"
// dropdowns — excludes legacy values entirely.
export const SELECTABLE_STATUSES: ProposalStatus[] = STATUS_GROUPS.filter((g) => g.key !== "legacy").flatMap((g) => g.statuses);
