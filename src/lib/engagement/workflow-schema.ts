import { createHash } from "crypto";
import { z } from "zod";
import { HttpError } from "@/lib/http-error";
import { CONDITION_STAGES, ENGAGEMENT_EVENT_TYPES, ENGAGEMENT_NOTIFICATION_TYPES, MAX_WAIT_HOURS, MAX_WORKFLOW_STEPS, REMINDER_KINDS, WORKFLOW_SAFE_STAGES, WORKFLOW_TASK_TYPES } from "@/lib/engagement/constants";

// STEP 30 — the engagement workflow definition. Everything is a CLOSED vocabulary validated with strict zod objects:
//   WHEN (trigger, stored on the workflow) IF (conditions) WAIT -> RECHECK -> ACTION
// There is NO step type for: approving anything, sharing contact details, finalizing a proposal, suspending or deleting an
// account, refunds, permission changes, launching ads or changing a budget. There is NO condition field for an activity
// score, risk signal, religion, health, income, hardship or any other protected / sensitive attribute: an unknown key is a
// validation error (.strict()), so a definition cannot smuggle one in.

const plain = (max: number) =>
  z
    .string()
    .trim()
    .min(3)
    .max(max)
    .refine((v) => !/[<>]/.test(v) && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(v), "Text must be plain text.");

export const conditionsSchema = z
  .object({
    stageIn: z.array(z.enum(CONDITION_STAGES)).min(1).max(8).optional(),
    completionLt: z.number().int().min(1).max(100).optional(),
    completionGte: z.number().int().min(0).max(100).optional(),
    verificationNotComplete: z.boolean().optional(),
    hasOpenProposal: z.boolean().optional(),
    inactiveDaysGte: z.number().int().min(1).max(365).optional(),
    membershipActive: z.boolean().optional(),
    language: z.enum(["EN", "UR"]).optional(),
  })
  .strict();
export type WorkflowConditions = z.infer<typeof conditionsSchema>;

const stepSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("WAIT"), hours: z.number().int().min(1).max(MAX_WAIT_HOURS) }).strict(),
  // Re-evaluates the conditions + cancelOn at this point; if they no longer hold the run is cancelled (never sends).
  z.object({ type: z.literal("RECHECK_ELIGIBLE") }).strict(),
  z.object({ type: z.literal("CREATE_TASK"), taskType: z.enum(WORKFLOW_TASK_TYPES), title: plain(140).optional() }).strict(),
  z.object({ type: z.literal("NOTIFY_APPLICANT"), kind: z.enum(REMINDER_KINDS), notificationType: z.enum(ENGAGEMENT_NOTIFICATION_TYPES as [string, ...string[]]).optional() }).strict(),
  // Only reaches family members the applicant has shared that exact proposal/meeting with and who hold the delegated permission.
  z.object({ type: z.literal("NOTIFY_FAMILY"), kind: z.enum(["PROPOSAL_PENDING", "MEETING_UNCONFIRMED"]) }).strict(),
  z.object({ type: z.literal("REQUEST_FEEDBACK") }).strict(),
  z.object({ type: z.literal("UPDATE_CRM_STAGE"), toStage: z.enum(WORKFLOW_SAFE_STAGES) }).strict(),
]);
export type WorkflowStep = z.infer<typeof stepSchema>;

export const definitionSchema = z
  .object({
    conditions: conditionsSchema.default({}),
    cancelOn: z.array(z.enum(ENGAGEMENT_EVENT_TYPES as [string, ...string[]])).max(8).default([]),
    steps: z.array(stepSchema).min(1).max(MAX_WORKFLOW_STEPS),
  })
  .strict();
export type WorkflowDefinition = z.infer<typeof definitionSchema>;

export function parseDefinition(input: unknown): WorkflowDefinition {
  const parsed = definitionSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new HttpError(422, `Invalid workflow definition at ${issue.path.join(".") || "root"}: ${issue.message}. Only the listed conditions and steps are allowed.`);
  }
  const def = parsed.data;
  // A sending step must be preceded by a RECHECK so a run never sends on stale eligibility.
  let rechecked = false;
  for (const step of def.steps) {
    if (step.type === "RECHECK_ELIGIBLE") rechecked = true;
    else if ((step.type === "NOTIFY_APPLICANT" || step.type === "NOTIFY_FAMILY" || step.type === "REQUEST_FEEDBACK") && !rechecked) {
      throw new HttpError(422, "Every step that sends a message must come after a RECHECK_ELIGIBLE step, so nothing is sent on stale eligibility.");
    }
  }
  return def;
}

export function definitionHash(def: WorkflowDefinition, trigger: string): string {
  return createHash("sha256").update(JSON.stringify({ trigger, def })).digest("hex");
}

// Every text a workflow can carry (task titles) in one list, for the content scanner.
export function definitionTexts(def: WorkflowDefinition): Array<{ field: string; text: string }> {
  return def.steps.flatMap((s, i) => (s.type === "CREATE_TASK" && s.title ? [{ field: `steps[${i}].title`, text: s.title }] : []));
}
