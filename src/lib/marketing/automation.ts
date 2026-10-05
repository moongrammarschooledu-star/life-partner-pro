import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { createTask } from "@/lib/workflow/engine";
import { autoAssign } from "@/lib/crm/assignment-service";
import { transitionStage } from "@/lib/crm/lifecycle-service";
import { notifyLeadAssignedToYou } from "@/lib/notifications/events";
import { marketingAudit } from "@/lib/marketing/audit";
import { MARKETING_FLAGS } from "@/lib/marketing/constants";
import type { SessionAdmin } from "@/lib/route-guard";
import type { CrmLifecycleStage, Lead, MarketingAutomationRule } from "@prisma/client";

// STEP 29 §26 — marketing automation. The action vocabulary is a CLOSED, whitelisted union: nothing here can approve
// verification, share contacts, finalize a proposal, suspend/delete an account, refund, launch an ad or raise a budget
// (there is simply no action type for any of them). Messaging a Profile-less lead is also not an action: the
// communications policy engine only addresses Profiles, so staff follow up through tasks. A rule must be approved by
// someone other than its author before it can run, and every execution is idempotent per (rule, subject).

export const AUTOMATION_TRIGGERS = [
  "LEAD_CREATED", "FORM_SUBMITTED", "WHATSAPP_STARTED", "LEAD_UNRESPONDED", "REGISTRATION_STARTED",
  "REGISTRATION_COMPLETED", "PROFILE_INCOMPLETE", "VERIFICATION_PENDING",
] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

// Only early-lifecycle, non-decision stages may be set automatically (never VERIFIED, MATCHING and beyond, or any exit stage).
const SAFE_STAGES = ["PROFILE_INCOMPLETE", "PROFILE_SUBMITTED", "UNDER_REVIEW", "VERIFICATION_PENDING"] as const;

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("CREATE_TASK"), title: z.string().trim().min(3).max(140), priority: z.enum(["LOW", "NORMAL", "HIGH"]).optional() }),
  z.object({ type: z.literal("ASSIGN_LEAD") }),
  z.object({ type: z.literal("SCHEDULE_FOLLOWUP"), title: z.string().trim().min(3).max(140), dueInHours: z.number().int().min(1).max(24 * 30) }),
  z.object({ type: z.literal("NOTIFY_STAFF") }),
  z.object({ type: z.literal("UPDATE_CRM_STAGE"), toStage: z.enum(SAFE_STAGES) }),
]);
export type AutomationAction = z.infer<typeof actionSchema>;

const conditionsSchema = z.object({
  campaignId: z.string().min(1).max(40).optional(),
  source: z.string().min(1).max(30).optional(),
  unrespondedHours: z.number().int().min(1).max(24 * 30).optional(),
}).strict();

export function parseActions(input: unknown): AutomationAction[] {
  const parsed = z.array(actionSchema).min(1).max(5).safeParse(input);
  if (!parsed.success) throw new HttpError(422, `Invalid automation actions: ${parsed.error.issues[0].message}. Only whitelisted actions are allowed.`);
  return parsed.data;
}

export function parseConditions(input: unknown) {
  const parsed = conditionsSchema.safeParse(input ?? {});
  if (!parsed.success) throw new HttpError(422, `Invalid automation conditions: ${parsed.error.issues[0].message}`);
  return parsed.data;
}

export async function createAutomationRule(actor: SessionAdmin, input: { name: string; trigger: string; conditions?: unknown; actions: unknown }): Promise<MarketingAutomationRule> {
  if (!(AUTOMATION_TRIGGERS as readonly string[]).includes(input.trigger)) throw new HttpError(422, "Unknown trigger.");
  const name = input.name.trim();
  if (name.length < 3 || name.length > 120 || /[<>]/.test(name)) throw new HttpError(422, "A valid name is required.");
  const rule = await prisma.marketingAutomationRule.create({
    data: { name, trigger: input.trigger, conditions: parseConditions(input.conditions) as never, actions: parseActions(input.actions) as never, createdById: actor.id },
  });
  await marketingAudit({ action: "MARKETING_AUTOMATION_RULE_CHANGED", actorId: actor.id, resource: "automation_rule", resourceId: rule.id, after: { trigger: rule.trigger, enabled: false, version: 1 } });
  return rule;
}

// Editing bumps the version and DISABLES the rule: new behaviour needs a fresh independent approval.
export async function updateAutomationRule(actor: SessionAdmin, id: string, patch: { name?: string; conditions?: unknown; actions?: unknown }): Promise<MarketingAutomationRule> {
  const rule = await prisma.marketingAutomationRule.findUnique({ where: { id } });
  if (!rule) throw new HttpError(404, "Rule not found.");
  const updated = await prisma.marketingAutomationRule.update({
    where: { id },
    data: {
      ...(patch.name ? { name: patch.name.trim().slice(0, 120) } : {}),
      ...(patch.conditions !== undefined ? { conditions: parseConditions(patch.conditions) as never } : {}),
      ...(patch.actions !== undefined ? { actions: parseActions(patch.actions) as never } : {}),
      version: { increment: 1 }, enabled: false, approvedById: null, createdById: actor.id,
    },
  });
  await marketingAudit({ action: "MARKETING_AUTOMATION_RULE_CHANGED", actorId: actor.id, resource: "automation_rule", resourceId: id, before: { version: rule.version, enabled: rule.enabled }, after: { version: updated.version, enabled: false } });
  return updated;
}

export async function setAutomationRuleEnabled(actor: SessionAdmin, id: string, enabled: boolean, reason: string): Promise<MarketingAutomationRule> {
  const rule = await prisma.marketingAutomationRule.findUnique({ where: { id } });
  if (!rule) throw new HttpError(404, "Rule not found.");
  if (reason.trim().length < 5) throw new HttpError(422, "A reason is required.");
  if (enabled && actor.id === rule.createdById) throw new HttpError(403, "A rule must be enabled by someone other than its author.");
  const updated = await prisma.marketingAutomationRule.update({ where: { id }, data: { enabled, approvedById: enabled ? actor.id : null } });
  await marketingAudit({ action: "MARKETING_AUTOMATION_RULE_CHANGED", actorId: actor.id, resource: "automation_rule", resourceId: id, before: { enabled: rule.enabled }, after: { enabled }, reason });
  return updated;
}

function conditionsMatch(rule: MarketingAutomationRule, lead: Pick<Lead, "campaignId" | "source">): boolean {
  const c = (rule.conditions ?? {}) as { campaignId?: string; source?: string };
  if (c.campaignId && lead.campaignId !== c.campaignId) return false;
  if (c.source && lead.source !== c.source) return false;
  return true;
}

async function runAction(action: AutomationAction, lead: Lead): Promise<string> {
  switch (action.type) {
    case "CREATE_TASK": {
      await createTask({ taskType: "CRM_LEAD_REVIEW", resourceType: "LEAD", resourceId: lead.id, title: action.title, priority: action.priority ?? "NORMAL", dedupe: false });
      return "TASK_CREATED";
    }
    case "SCHEDULE_FOLLOWUP": {
      await createTask({ taskType: "CRM_LEAD_REVIEW", resourceType: "LEAD", resourceId: lead.id, title: action.title, dueAt: new Date(Date.now() + action.dueInHours * 3_600_000), dedupe: false });
      return "FOLLOWUP_TASK_SCHEDULED";
    }
    case "ASSIGN_LEAD": {
      if (lead.assignedStaffId) return "ALREADY_ASSIGNED";
      const campaign = lead.campaignId ? await prisma.marketingCampaign.findUnique({ where: { id: lead.campaignId }, select: { routingDepartmentId: true, responsibleAdminId: true, createdById: true } }) : null;
      if (!campaign) return "NO_CAMPAIGN_ROUTING";
      const chosen = await autoAssign("LEAD", lead.id, campaign.routingDepartmentId, campaign.responsibleAdminId ?? campaign.createdById);
      return chosen ? "ASSIGNED" : "NO_RULE_CONFIGURED";
    }
    case "NOTIFY_STAFF": {
      const fresh = await prisma.lead.findUnique({ where: { id: lead.id }, select: { assignedStaffId: true } });
      if (!fresh?.assignedStaffId) return "NO_ASSIGNEE";
      await notifyLeadAssignedToYou(fresh.assignedStaffId, lead.id);
      return "STAFF_NOTIFIED";
    }
    case "UPDATE_CRM_STAGE": {
      if (!lead.convertedCrmRecordId) return "NOT_CONVERTED";
      try {
        await transitionStage({ crmRecordId: lead.convertedCrmRecordId, toStage: action.toStage as CrmLifecycleStage, triggeredBy: "AUTOMATION", reason: "Marketing automation" });
        return "STAGE_UPDATED";
      } catch {
        return "TRANSITION_NOT_VALID"; // forward-only guard: an invalid move is skipped, never forced
      }
    }
  }
}

// Fire-and-forget safe: never throws. Returns how many rules ran.
export async function triggerAutomation(trigger: AutomationTrigger, subject: { leadId: string }): Promise<number> {
  try {
    if (!(await isFeatureEnabled(MARKETING_FLAGS.master)) || !(await isFeatureEnabled(MARKETING_FLAGS.automation))) return 0;
    const lead = await prisma.lead.findUnique({ where: { id: subject.leadId } });
    if (!lead) return 0;
    // A suppressed/declined/duplicate-under-review lead is never automated.
    if (["DO_NOT_CONTACT", "INVALID", "DUPLICATE", "ARCHIVED", "DUPLICATE_REVIEW_REQUIRED"].includes(lead.status)) return 0;
    const rules = await prisma.marketingAutomationRule.findMany({ where: { trigger, enabled: true, approvedById: { not: null } } });
    let ran = 0;
    for (const rule of rules) {
      if (!conditionsMatch(rule, lead)) continue;
      let runId: string;
      try {
        const run = await prisma.marketingAutomationRun.create({ data: { ruleId: rule.id, ruleVersion: rule.version, subjectType: "LEAD", subjectId: lead.id, status: "PENDING" } });
        runId = run.id;
      } catch {
        continue; // already ran for this rule + lead
      }
      const results: string[] = [];
      let failed: string | null = null;
      try {
        for (const action of parseActions(rule.actions)) results.push(`${action.type}:${await runAction(action, lead)}`);
      } catch (e) {
        failed = e instanceof Error ? e.message.slice(0, 200) : "ACTION_FAILED";
      }
      await prisma.marketingAutomationRun.update({ where: { id: runId }, data: { status: failed ? "FAILED" : "SUCCEEDED", result: { actions: results } as never, error: failed } });
      await marketingAudit({ action: "MARKETING_AUTOMATION_RUN", actorId: null, resource: "automation_rule", resourceId: rule.id, after: { trigger, status: failed ? "FAILED" : "SUCCEEDED" }, extra: { leadId: lead.id, actions: results } });
      ran++;
    }
    return ran;
  } catch (error) {
    console.error("[marketing] automation trigger failed", error instanceof Error ? error.message : error);
    return 0;
  }
}

// Daily sweep for time/state-based triggers. Bounded batches, idempotent via the run table.
export async function runAutomationSweep(now = new Date()): Promise<{ unresponded: number; profileIncomplete: number; verificationPending: number }> {
  const out = { unresponded: 0, profileIncomplete: 0, verificationPending: 0 };
  if (!(await isFeatureEnabled(MARKETING_FLAGS.master)) || !(await isFeatureEnabled(MARKETING_FLAGS.automation))) return out;

  const unrespondedRules = await prisma.marketingAutomationRule.findMany({ where: { trigger: "LEAD_UNRESPONDED", enabled: true, approvedById: { not: null } } });
  for (const rule of unrespondedRules) {
    const hours = ((rule.conditions ?? {}) as { unrespondedHours?: number }).unrespondedHours ?? 48;
    const leads = await prisma.lead.findMany({ where: { status: "NEW", campaignId: { not: null }, capturedAt: { lte: new Date(now.getTime() - hours * 3_600_000) } }, select: { id: true }, take: 200 });
    for (const l of leads) out.unresponded += await triggerAutomation("LEAD_UNRESPONDED", { leadId: l.id });
  }

  const converted = await prisma.lead.findMany({ where: { campaignId: { not: null }, convertedProfileId: { not: null }, status: { in: ["REGISTERED", "CONVERTED", "REGISTRATION_STARTED"] } }, select: { id: true, convertedProfileId: true }, orderBy: { convertedAt: "desc" }, take: 200 });
  for (const l of converted) {
    const profile = await prisma.profile.findUnique({ where: { id: l.convertedProfileId as string }, select: { profileCompletion: true, verification: { select: { status: true } } } });
    if (!profile) continue;
    if (profile.profileCompletion < 100) out.profileIncomplete += await triggerAutomation("PROFILE_INCOMPLETE", { leadId: l.id });
    if (profile.verification?.status === "VERIFICATION_PENDING") out.verificationPending += await triggerAutomation("VERIFICATION_PENDING", { leadId: l.id });
  }
  return out;
}
