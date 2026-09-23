import { prisma } from "@/lib/prisma";
import type { AdminTaskType, AssignmentPriority, AdminRole } from "@prisma/client";

// STEP 18 §19 — admin-configurable event→task-type automation table, seeded
// with the concrete hooks this step actually wires (src/lib/privacy/privacy-request.ts,
// src/lib/ai/record.ts, src/lib/finance/rollout.ts's reportPaymentIncident,
// src/lib/finance/refund.ts, the payments webhook, and the manual-payment
// confirm route). Editable afterward via the automation-rules API — this
// table is metadata for the admin UI, not itself consulted by
// createFromEvent() callers (each call site already knows its own taskType).
export interface DefaultWorkflowRule {
  eventName: string;
  taskType: AdminTaskType;
  defaultPriority: AssignmentPriority;
  defaultAssignedRole?: AdminRole;
}

export const DEFAULT_WORKFLOW_RULES: DefaultWorkflowRule[] = [
  { eventName: "PRIVACY_REQUEST_CREATED", taskType: "PRIVACY_REQUEST_TASK", defaultPriority: "NORMAL", defaultAssignedRole: "SUPER_ADMIN" },
  { eventName: "AI_REVIEW_REQUIRED", taskType: "AI_SAFETY_REVIEW", defaultPriority: "HIGH", defaultAssignedRole: "SUPER_ADMIN" },
  { eventName: "RECONCILIATION_MISMATCH", taskType: "RECONCILIATION_REVIEW", defaultPriority: "HIGH", defaultAssignedRole: "FINANCE_MANAGER" },
  { eventName: "REFUND_REQUESTED", taskType: "REFUND_REVIEW", defaultPriority: "NORMAL", defaultAssignedRole: "FINANCE_MANAGER" },
  { eventName: "PAYMENT_FAILED", taskType: "PAYMENT_ISSUE_REVIEW", defaultPriority: "NORMAL", defaultAssignedRole: "FINANCE_MANAGER" },
  { eventName: "MANUAL_PAYMENT_REQUIRES_REVIEW", taskType: "PAYMENT_ISSUE_REVIEW", defaultPriority: "NORMAL", defaultAssignedRole: "FINANCE_MANAGER" },
];

// Idempotent — only inserts rules that don't already exist by eventName, so
// re-running (e.g. on every deploy) never overwrites an admin's own edits.
export async function seedDefaultWorkflowRules(): Promise<number> {
  const existing = await prisma.workflowRule.findMany({ select: { eventName: true } });
  const already = new Set(existing.map((r) => r.eventName));
  const toCreate = DEFAULT_WORKFLOW_RULES.filter((r) => !already.has(r.eventName));
  if (toCreate.length === 0) return 0;
  await prisma.workflowRule.createMany({
    data: toCreate.map((r) => ({ eventName: r.eventName, taskType: r.taskType, defaultPriority: r.defaultPriority, defaultAssignedRole: r.defaultAssignedRole ?? null })),
  });
  return toCreate.length;
}

export async function resolveWorkflowRule(eventName: string) {
  return prisma.workflowRule.findUnique({ where: { eventName } });
}
