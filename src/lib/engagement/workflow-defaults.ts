import type { EngagementEventType } from "@prisma/client";
import type { WorkflowDefinition } from "@/lib/engagement/workflow-schema";

// STEP 30 — the lifecycle automations from the specification, shipped as DRAFTS ("Install defaults" in the admin screen). Nothing
// here runs until someone reviews it, a DIFFERENT person approves it, and it is published through the STEP 19 gate. Waits are
// hours; the daily cron means a wait is honoured to the next daily tick. Every message-sending step follows a RECHECK_ELIGIBLE.

export interface DefaultWorkflow {
  name: string;
  description: string;
  trigger: EngagementEventType;
  definition: WorkflowDefinition;
}

export const DEFAULT_WORKFLOWS: DefaultWorkflow[] = [
  {
    name: "New applicant: staff welcome check",
    description: "When someone registers, create one staff task to make sure they can complete their profile.",
    trigger: "USER_REGISTERED",
    definition: { conditions: {}, cancelOn: [], steps: [{ type: "CREATE_TASK", taskType: "GENERAL_ADMIN_TASK", title: "Welcome check for a newly registered applicant" }] },
  },
  {
    name: "Profile completion reminder",
    description: "One reminder if the profile is still incomplete after the wait; stops as soon as it is completed or submitted.",
    trigger: "PROFILE_STARTED",
    definition: { conditions: { completionLt: 100 }, cancelOn: ["PROFILE_COMPLETED", "PROFILE_SUBMITTED"], steps: [{ type: "WAIT", hours: 72 }, { type: "RECHECK_ELIGIBLE" }, { type: "NOTIFY_APPLICANT", kind: "PROFILE_INCOMPLETE" }] },
  },
  {
    name: "Profile submitted: review task",
    description: "Create the staff review task when a profile is submitted.",
    trigger: "PROFILE_SUBMITTED",
    definition: { conditions: {}, cancelOn: [], steps: [{ type: "CREATE_TASK", taskType: "NEW_PROFILE_REVIEW" }] },
  },
  {
    name: "Verification follow-up",
    description: "If verification has not progressed after the wait, create a staff follow-up and send one reminder.",
    trigger: "VERIFICATION_STARTED",
    definition: { conditions: { verificationNotComplete: true }, cancelOn: ["VERIFICATION_COMPLETED"], steps: [{ type: "WAIT", hours: 72 }, { type: "RECHECK_ELIGIBLE" }, { type: "CREATE_TASK", taskType: "VERIFICATION_REQUEST", title: "Follow up on a verification that has not progressed" }, { type: "NOTIFY_APPLICANT", kind: "VERIFICATION_STALLED" }] },
  },
  {
    name: "Proposal waiting for a response",
    description: "One gentle reminder (and, only where the applicant shared the proposal, their delegated family members) if a proposal has had no response; stops when they respond.",
    trigger: "PROPOSAL_RECEIVED",
    definition: { conditions: { hasOpenProposal: true }, cancelOn: ["PROPOSAL_RESPONSE_RECEIVED"], steps: [{ type: "WAIT", hours: 72 }, { type: "RECHECK_ELIGIBLE" }, { type: "NOTIFY_APPLICANT", kind: "PROPOSAL_PENDING" }, { type: "NOTIFY_FAMILY", kind: "PROPOSAL_PENDING" }] },
  },
  {
    name: "Meeting request awaiting confirmation",
    description: "One reminder if a meeting request has not been confirmed; stops when it is scheduled or completed.",
    trigger: "MEETING_REQUESTED",
    definition: { conditions: {}, cancelOn: ["MEETING_SCHEDULED", "MEETING_COMPLETED"], steps: [{ type: "WAIT", hours: 48 }, { type: "RECHECK_ELIGIBLE" }, { type: "NOTIFY_APPLICANT", kind: "MEETING_UNCONFIRMED" }] },
  },
  {
    name: "After a meeting: staff follow-up and optional feedback",
    description: "Create the staff follow-up task, then offer the optional feedback form. Feedback never changes a proposal.",
    trigger: "MEETING_COMPLETED",
    definition: { conditions: {}, cancelOn: [], steps: [{ type: "CREATE_TASK", taskType: "MEETING_FOLLOWUP" }, { type: "WAIT", hours: 72 }, { type: "RECHECK_ELIGIBLE" }, { type: "REQUEST_FEEDBACK" }] },
  },
  {
    name: "Gentle re-engagement after a long break",
    description: "One reminder when an applicant has been inactive for the configured period; stops the moment they return.",
    trigger: "REENGAGEMENT_ELIGIBLE",
    definition: { conditions: { inactiveDaysGte: 30 }, cancelOn: ["LOGIN", "PROFILE_COMPLETED", "PROPOSAL_RESPONSE_RECEIVED", "SUPPORT_CASE_CREATED"], steps: [{ type: "RECHECK_ELIGIBLE" }, { type: "NOTIFY_APPLICANT", kind: "INACTIVITY" }] },
  },
  {
    name: "Membership ending soon: factual notice",
    description: "A factual notice that the membership period is ending. Uses plain wording about the plan's features, no claims about results.",
    trigger: "MEMBERSHIP_EXPIRING",
    definition: { conditions: { membershipActive: true }, cancelOn: ["MEMBERSHIP_STARTED"], steps: [{ type: "RECHECK_ELIGIBLE" }, { type: "NOTIFY_APPLICANT", kind: "MEMBERSHIP_EXPIRING" }] },
  },
];
