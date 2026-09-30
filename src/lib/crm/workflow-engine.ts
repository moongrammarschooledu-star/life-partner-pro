import { createFromEvent } from "@/lib/workflow/engine";
import { createLead, convertLead } from "@/lib/crm/lead-service";
import { createCrmRecord } from "@/lib/crm/crm-record-service";
import { transitionStage } from "@/lib/crm/lifecycle-service";
import { assignRecord, autoAssign } from "@/lib/crm/assignment-service";
import { createFollowup } from "@/lib/crm/followup-service";
import { applyTag, removeTag } from "@/lib/crm/crm-record-service";
import { classifyFollowupSla } from "@/lib/crm/followup-service";
import { classifyTaskSla, computeTaskSlaDueDates } from "@/lib/workflow/sla";

// STEP 28 §57/§58/§59 — CRMWorkflowEngine. A coordination FACADE only: every
// method below delegates to an existing service (this file or STEP 18's
// workflow engine) — it holds no independent business logic of its own. The
// "never automate an irreversible decision" rule (spec §59: verification
// approval, contact-sharing approval, proposal finalization, suspension,
// profile deletion, permission changes, refunds) is enforced BY CONSTRUCTION:
// this facade simply has no method that calls any of those mutating
// functions — createTask/createLifecycleTask only ever create a REVIEW task
// pointing a human at the decision, exactly like every other STEP's
// approval-adjacent automation already does.
//
// Automation rules themselves are admin-configurable via the existing
// WorkflowRule table (src/lib/workflow/engine.ts's createFromEvent already
// reads it) — no new, parallel "CrmAutomationRule" table exists or is needed.

export const CRMWorkflowEngine = {
  createLead,
  convertLead,
  createCRMRecord: createCrmRecord,
  transitionLifecycle: transitionStage,
  assignRecord,
  autoAssignRecord: autoAssign,
  createFollowup,
  createTask: createFromEvent,
  applyTag,
  removeTag,
  // triggerCommunication deliberately does NOT exist here — sending a
  // message always goes through src/lib/communications' own
  // CommunicationPolicyEngine-gated send path directly; a facade wrapper
  // here would be a second entry point to the same mutating action for no
  // benefit, which spec §40 explicitly warns against ("must NOT bypass
  // CommunicationPolicyEngine"). Callers that need to message an applicant
  // from a CRM screen call src/lib/communications/thread-service.ts /
  // send-service.ts directly, the same as every other admin surface does.
  evaluateFollowupSla: classifyFollowupSla,
  evaluateTaskSla: classifyTaskSla,
  computeTaskSlaDueDates,
};
