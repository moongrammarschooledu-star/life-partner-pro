// Client-safe description of the risk-case state machine (no server imports), so the admin UI and
// case-service.ts share ONE definition of which action is allowed from which status.
import type { RiskCaseStatus, RiskLevel, RiskReviewDecisionType, RiskState } from "@prisma/client";

export const ACTIVE_CASE_STATUSES: RiskCaseStatus[] = ["OPEN", "ACKNOWLEDGED", "UNDER_INVESTIGATION", "INFORMATION_REQUESTED", "ESCALATED", "RESTRICTED", "SUSPENDED"];
export const TERMINAL_CASE_STATUSES: RiskCaseStatus[] = ["CLEARED", "DISMISSED", "FALSE_POSITIVE", "CLOSED"];

export const LEVEL_ORDER: Record<RiskLevel, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

export type RiskCaseAction = RiskReviewDecisionType;

export const REVIEWABLE: RiskCaseStatus[] = ["OPEN", "ACKNOWLEDGED", "UNDER_INVESTIGATION", "INFORMATION_REQUESTED", "ESCALATED"];
export const TRANSITIONS: Record<RiskCaseAction, { from: RiskCaseStatus[]; to?: RiskCaseStatus; state?: RiskState }> = {
  ACKNOWLEDGE: { from: ["OPEN"], to: "ACKNOWLEDGED", state: "UNDER_REVIEW" },
  INVESTIGATE: { from: ["OPEN", "ACKNOWLEDGED", "INFORMATION_REQUESTED", "ESCALATED"], to: "UNDER_INVESTIGATION", state: "UNDER_REVIEW" },
  REQUEST_INFORMATION: { from: REVIEWABLE, to: "INFORMATION_REQUESTED", state: "UNDER_REVIEW" },
  REQUEST_REVERIFICATION: { from: REVIEWABLE, to: "INFORMATION_REQUESTED", state: "UNDER_REVIEW" },
  ESCALATE: { from: ["OPEN", "ACKNOWLEDGED", "UNDER_INVESTIGATION", "INFORMATION_REQUESTED"], to: "ESCALATED", state: "UNDER_REVIEW" },
  DISMISS: { from: REVIEWABLE, to: "DISMISSED", state: "CLEARED" },
  MARK_FALSE_POSITIVE: { from: [...REVIEWABLE, "RESTRICTED"], to: "FALSE_POSITIVE", state: "CLEARED" },
  CLEAR: { from: [...REVIEWABLE, "RESTRICTED", "SUSPENDED"], to: "CLEARED", state: "CLEARED" },
  RESTRICT: { from: ["ACKNOWLEDGED", "UNDER_INVESTIGATION", "INFORMATION_REQUESTED", "ESCALATED", "RESTRICTED"], to: "RESTRICTED", state: "RESTRICTED" },
  SUSPEND: { from: ["ACKNOWLEDGED", "UNDER_INVESTIGATION", "INFORMATION_REQUESTED", "ESCALATED", "RESTRICTED"], to: "SUSPENDED", state: "SUSPENDED" },
  CLOSE: { from: [...ACTIVE_CASE_STATUSES, "CLEARED", "DISMISSED", "FALSE_POSITIVE"] as RiskCaseStatus[], to: "CLOSED" },
};

// Required review checklist for any action that limits an account (spec: "required
// review checklist"). All items must be affirmatively true.
export const ADVERSE_CHECKLIST_KEYS = ["evidenceReviewed", "falsePositivesConsidered", "lessRestrictiveOptionConsidered"] as const;

export function isActionAllowed(status: RiskCaseStatus, action: RiskCaseAction): boolean {
  return TRANSITIONS[action].from.includes(status);
}
