import type { ApprovalStatus } from "@prisma/client";

// STEP 19 §3/§4 — every status transition is validated server-side through
// this table; nothing sets ApprovalRequest.status directly except
// src/lib/approvals/engine.ts. Mirrors src/lib/workflow/status.ts's exact
// convention (ALLOWED_TRANSITIONS + isValidTransition). LEVEL_0 ("no
// approval required") never enters this state machine at all — gate.ts's
// requiresApproval() returns false and the caller proceeds directly, so no
// ApprovalRequest row is created for it.
export const ALLOWED_TRANSITIONS: Record<ApprovalStatus, ApprovalStatus[]> = {
  DRAFT: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["PENDING_REVIEW", "PENDING_APPROVAL", "CANCELLED"],
  PENDING_REVIEW: ["PENDING_APPROVAL", "CHANGES_REQUESTED", "REJECTED", "CANCELLED"],
  PENDING_APPROVAL: ["PARTIALLY_APPROVED", "APPROVED", "REJECTED", "CHANGES_REQUESTED", "CANCELLED", "EXPIRED"],
  PARTIALLY_APPROVED: ["PENDING_APPROVAL", "APPROVED", "REJECTED", "CHANGES_REQUESTED", "CANCELLED", "EXPIRED"],
  APPROVED: ["EXECUTION_PENDING", "CANCELLED", "EXPIRED"],
  REJECTED: ["REOPENED", "ARCHIVED"],
  CHANGES_REQUESTED: ["SUBMITTED", "CANCELLED", "ARCHIVED"],
  EXPIRED: ["REOPENED", "ARCHIVED"],
  CANCELLED: ["ARCHIVED"],
  EXECUTION_PENDING: ["EXECUTING", "EXECUTION_FAILED"],
  EXECUTING: ["EXECUTED", "EXECUTION_FAILED"],
  EXECUTED: ["ARCHIVED"],
  EXECUTION_FAILED: ["EXECUTION_PENDING", "CANCELLED", "ARCHIVED"],
  REOPENED: ["SUBMITTED", "PENDING_REVIEW", "PENDING_APPROVAL", "CANCELLED"],
  ARCHIVED: [],
};

// "Still open / awaiting a decision" — used for queue counts, expiration
// sweeps, and dashboard KPIs.
export const ACTIVE_APPROVAL_STATUSES: ApprovalStatus[] = [
  "SUBMITTED",
  "PENDING_REVIEW",
  "PENDING_APPROVAL",
  "PARTIALLY_APPROVED",
];

export const TERMINAL_APPROVAL_STATUSES: ApprovalStatus[] = ["EXECUTED", "CANCELLED", "ARCHIVED"];

// A request in one of these statuses can still be decided upon (approve/
// reject/request-changes) — used by policy-engine.ts's canApprove/canReject.
export const DECIDABLE_APPROVAL_STATUSES: ApprovalStatus[] = ["PENDING_REVIEW", "PENDING_APPROVAL", "PARTIALLY_APPROVED"];

export function isValidTransition(from: ApprovalStatus, to: ApprovalStatus): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}
