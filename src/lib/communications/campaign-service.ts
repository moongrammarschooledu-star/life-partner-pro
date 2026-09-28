import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http-error";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { enforceApprovalGate, markApprovalExecuted } from "@/lib/approvals/gate";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { buildWhereFromFilterGroup, validateFilterGroup, FilterValidationError, type FilterGroup, type FilterRule } from "@/lib/search/filter-builder";
import { isForbiddenTraitField } from "@/lib/risk/config";
import type { SessionAdmin } from "@/lib/route-guard";
import type { CommunicationCampaign, CommunicationMessageType, CommunicationPurpose, NotificationChannel } from "@prisma/client";
import { communicate } from "@/lib/communications/send-service";
import { canSend } from "@/lib/communications/policy-engine";
import { buildTemplateValues } from "@/lib/communications/template-values";
import { COMMUNICATION_VARIABLES, renderTemplate, TemplateRenderError, toHtmlEmail } from "@/lib/communications/secure-renderer";
import { ALLOWED_PURPOSES } from "@/lib/communications/classify";

// Controlled bulk communication (spec §50-§55). Nothing here accepts SQL or a free-form recipient list:
//   - the audience is a filter over an explicit ALLOW-LIST of low-risk profile fields, validated by the existing search validator;
//   - sensitive traits (religion, ethnicity, health, income, family background, ...) can never be a targeting field;
//   - every recipient goes through the SAME policy engine as a single message (consent, suppression, jurisdiction, frequency, ...);
//   - a campaign must be reviewed and APPROVED by someone other than its creator before it can start, and a large or marketing
//     campaign additionally goes through the STEP 19 gate.

export const CAMPAIGN_FILTER_FIELDS = ["status", "verificationStatus", "verified", "city", "area", "country", "languages", "age"] as const;
export const MAX_CAMPAIGN_RECIPIENTS = 5000;
export const CAMPAIGN_APPROVAL_THRESHOLD = 50; // at or above this many recipients (or any marketing) the STEP 19 gate applies
const BATCH_SIZE = 50;

function isGroup(x: FilterRule | FilterGroup): x is FilterGroup {
  return (x as FilterGroup).rules !== undefined;
}

export function assertAudienceAllowed(group: FilterGroup): void {
  const walk = (g: FilterGroup) => {
    for (const r of g.rules) {
      if (isGroup(r)) walk(r);
      else {
        if (isForbiddenTraitField(r.field)) throw new HttpError(422, `The field "${r.field}" is a sensitive trait and cannot be used to target communication.`);
        if (!(CAMPAIGN_FILTER_FIELDS as readonly string[]).includes(r.field)) throw new HttpError(422, `The field "${r.field}" cannot be used to target a campaign.`);
      }
    }
  };
  walk(group);
}

export function audienceWhere(group: FilterGroup) {
  // Baseline: only live, active accounts - deleted / deactivated profiles are never in an audience.
  return { AND: [{ softDeleted: false, accountStatus: "ACTIVE" as const }, buildWhereFromFilterGroup(group)] };
}

function parseFilter(raw: string): FilterGroup {
  return JSON.parse(raw) as FilterGroup;
}

export interface CampaignInput {
  name: string;
  purpose: CommunicationPurpose;
  messageType: CommunicationMessageType;
  channel: NotificationChannel;
  templateId: string;
  audienceFilter: unknown;
  scheduledAt?: Date | null;
}

async function requireFlags(messageType: CommunicationMessageType): Promise<void> {
  if (!(await isFeatureEnabled("communications.campaigns.enabled"))) throw new HttpError(409, "Communication campaigns are switched off.");
  if (messageType === "MARKETING" && !(await isFeatureEnabled("communications.marketing.enabled"))) throw new HttpError(409, "Marketing communication is switched off.");
}

async function validateInput(actor: SessionAdmin, input: CampaignInput): Promise<FilterGroup> {
  if (input.name.trim().length < 3) throw new HttpError(422, "A campaign name is required.");
  if (!ALLOWED_PURPOSES[input.messageType].includes(input.purpose)) throw new HttpError(422, "That purpose is not allowed for this message type.");
  if (["SECURITY", "VERIFICATION", "ADMIN_INTERNAL"].includes(input.messageType)) throw new HttpError(422, "Security, verification and internal messages cannot be sent as a campaign.");
  if (input.channel === "IN_APP") throw new HttpError(422, "Campaigns use e-mail, SMS or WhatsApp.");
  await requireFlags(input.messageType);
  const template = await prisma.communicationTemplate.findUnique({ where: { id: input.templateId } });
  if (!template || template.status !== "ACTIVE") throw new HttpError(422, "The template must exist and be ACTIVE.");
  if (template.channel !== input.channel || template.messageType !== input.messageType) throw new HttpError(422, "The template's channel and message type must match the campaign.");
  let group: FilterGroup;
  try {
    group = validateFilterGroup(input.audienceFilter, actor.permissions);
  } catch (error) {
    if (error instanceof FilterValidationError) throw new HttpError(422, error.message);
    throw error;
  }
  assertAudienceAllowed(group);
  return group;
}

export async function createCampaign(actor: SessionAdmin, input: CampaignInput): Promise<CommunicationCampaign> {
  const group = await validateInput(actor, input);
  const estimated = await prisma.profile.count({ where: audienceWhere(group) });
  const campaign = await prisma.communicationCampaign.create({
    data: {
      campaignCode: await nextSequenceCode("CAMP"),
      name: input.name.trim().slice(0, 120),
      purpose: input.purpose,
      messageType: input.messageType,
      channel: input.channel,
      templateId: input.templateId,
      audienceFilter: JSON.stringify(group),
      scheduledAt: input.scheduledAt ?? null,
      estimatedRecipients: estimated,
      createdById: actor.id,
    },
  });
  await writeAudit({ action: "COMMUNICATION_CAMPAIGN_CREATED", adminId: actor.id, meta: { campaignId: campaign.id, campaignCode: campaign.campaignCode, channel: input.channel, messageType: input.messageType, estimated } });
  return campaign;
}

export async function updateCampaign(actor: SessionAdmin, id: string, patch: Partial<Omit<CampaignInput, "messageType" | "channel">>): Promise<CommunicationCampaign> {
  const c = await load(id);
  if (c.status !== "DRAFT") throw new HttpError(409, "Only a draft campaign can be edited.");
  const merged: CampaignInput = { name: patch.name ?? c.name, purpose: patch.purpose ?? c.purpose, messageType: c.messageType, channel: c.channel, templateId: patch.templateId ?? c.templateId, audienceFilter: patch.audienceFilter ?? parseFilter(c.audienceFilter), scheduledAt: patch.scheduledAt === undefined ? c.scheduledAt : patch.scheduledAt };
  const group = await validateInput(actor, merged);
  const estimated = await prisma.profile.count({ where: audienceWhere(group) });
  return prisma.communicationCampaign.update({ where: { id }, data: { name: merged.name.trim().slice(0, 120), purpose: merged.purpose, templateId: merged.templateId, audienceFilter: JSON.stringify(group), scheduledAt: merged.scheduledAt ?? null, estimatedRecipients: estimated } });
}

async function load(id: string): Promise<CommunicationCampaign> {
  const c = await prisma.communicationCampaign.findUnique({ where: { id } });
  if (!c) throw new HttpError(404, "Campaign not found.");
  return c;
}

export async function getCampaign(id: string) {
  const c = await prisma.communicationCampaign.findUnique({ where: { id }, include: { recipients: { take: 0 } } });
  if (!c) throw new HttpError(404, "Campaign not found.");
  const counts = await prisma.communicationCampaignRecipient.groupBy({ by: ["status"], where: { campaignId: id }, _count: { _all: true } });
  return { campaign: c, recipientCounts: Object.fromEntries(counts.map((r) => [r.status, r._count._all])) };
}

// Estimated size + a dry-run of the policy engine on a SAMPLE, so the reviewer can see how many people would really be reached.
// Returns counts and a few profile codes only - never a name or a contact detail.
export async function previewAudience(actor: SessionAdmin, campaignId: string) {
  const c = await load(campaignId);
  const group = parseFilter(c.audienceFilter);
  const where = audienceWhere(group);
  const [estimated, sample] = await Promise.all([prisma.profile.count({ where }), prisma.profile.findMany({ where, select: { id: true, profileCode: true }, take: 100 })]);
  let eligible = 0;
  const blocked: Record<string, number> = {};
  for (const p of sample) {
    const d = await canSend({ recipient: { type: "PROFILE", profileId: p.id }, channel: c.channel, messageType: c.messageType, purpose: c.purpose, automated: false, initiatedBy: { adminId: actor.id, permissions: actor.permissions }, now: new Date() });
    if (d.allowed) eligible++;
    else blocked[d.blockedCode ?? "BLOCKED"] = (blocked[d.blockedCode ?? "BLOCKED"] ?? 0) + 1;
  }
  return { estimatedRecipients: estimated, sampled: sample.length, sampleEligible: eligible, sampleBlockedByReason: blocked, sampleProfileCodes: sample.slice(0, 10).map((p) => p.profileCode), capped: estimated > MAX_CAMPAIGN_RECIPIENTS, maxRecipients: MAX_CAMPAIGN_RECIPIENTS };
}

export async function submitCampaign(actor: SessionAdmin, id: string): Promise<CommunicationCampaign> {
  const c = await load(id);
  if (c.status !== "DRAFT") throw new HttpError(409, "Only a draft campaign can be submitted.");
  if ((c.estimatedRecipients ?? 0) > MAX_CAMPAIGN_RECIPIENTS) throw new HttpError(422, `A campaign cannot reach more than ${MAX_CAMPAIGN_RECIPIENTS} recipients; narrow the audience.`);
  const updated = await prisma.communicationCampaign.update({ where: { id }, data: { status: "REVIEW" } });
  await writeAudit({ action: "COMMUNICATION_CAMPAIGN_SUBMITTED", adminId: actor.id, meta: { campaignId: id } });
  return updated;
}

export type CampaignApprovalResult = { approvalRequired: false; campaign: CommunicationCampaign } | { approvalRequired: true; approvalCode: string; status: string };

export async function approveCampaign(actor: SessionAdmin, id: string): Promise<CampaignApprovalResult> {
  const c = await load(id);
  if (c.status !== "REVIEW") throw new HttpError(409, "Only a campaign under review can be approved.");
  if (c.createdById === actor.id) throw new HttpError(403, "You cannot approve a campaign that you created.");
  let approvalId: string | null = null;
  if (c.messageType === "MARKETING" || (c.estimatedRecipients ?? 0) >= CAMPAIGN_APPROVAL_THRESHOLD) {
    const gate = await enforceApprovalGate({ actionType: "BULK_COMMUNICATION_CAMPAIGN", sourceType: "CASE", sourceId: c.id, actor, reason: `Approve campaign ${c.campaignCode} (${c.estimatedRecipients ?? 0} estimated recipients)`, requestedPayload: { campaignId: c.id, estimated: c.estimatedRecipients } });
    if (gate.requiresApproval && gate.status !== "READY_TO_EXECUTE") return { approvalRequired: true, approvalCode: gate.approvalCode, status: gate.status };
    approvalId = gate.requiresApproval ? gate.approvalRequestId : null;
    if (gate.requiresApproval) await markApprovalExecuted(gate.approvalRequestId, actor.id);
  }
  const updated = await prisma.communicationCampaign.update({ where: { id }, data: { status: c.scheduledAt && c.scheduledAt.getTime() > Date.now() ? "SCHEDULED" : "APPROVED", approvedById: actor.id, approvalId } });
  await writeAudit({ action: "COMMUNICATION_CAMPAIGN_APPROVED", adminId: actor.id, meta: { campaignId: id, approvalId } });
  return { approvalRequired: false, campaign: updated };
}

export async function startCampaign(actor: SessionAdmin | null, id: string): Promise<CommunicationCampaign> {
  const c = await load(id);
  if (!["APPROVED", "SCHEDULED", "PAUSED"].includes(c.status)) throw new HttpError(409, "Only an approved, scheduled or paused campaign can be started.");
  await requireFlags(c.messageType);
  const template = await prisma.communicationTemplate.findUnique({ where: { id: c.templateId } });
  if (!template || template.status !== "ACTIVE") throw new HttpError(409, "The campaign template is no longer active.");

  if (c.status !== "PAUSED") {
    // Snapshot the audience ONCE, at start, so approval covered exactly this set of recipients.
    const group = parseFilter(c.audienceFilter);
    const profiles = await prisma.profile.findMany({ where: audienceWhere(group), select: { id: true }, take: MAX_CAMPAIGN_RECIPIENTS + 1 });
    if (profiles.length > MAX_CAMPAIGN_RECIPIENTS) throw new HttpError(422, `The audience grew beyond ${MAX_CAMPAIGN_RECIPIENTS}; re-create the campaign with a narrower filter.`);
    await prisma.communicationCampaignRecipient.createMany({ data: profiles.map((p) => ({ campaignId: id, profileId: p.id })), skipDuplicates: true });
  }
  const updated = await prisma.communicationCampaign.update({ where: { id }, data: { status: "RUNNING", startedAt: c.startedAt ?? new Date(), pausedAt: null } });
  await writeAudit({ action: "COMMUNICATION_CAMPAIGN_STARTED", adminId: actor?.id ?? null, meta: { campaignId: id, automatic: !actor } });
  await processCampaignBatch(id, { actor });
  return (await prisma.communicationCampaign.findUnique({ where: { id } })) ?? updated;
}

export async function pauseCampaign(actor: SessionAdmin, id: string): Promise<CommunicationCampaign> {
  const c = await load(id);
  if (c.status !== "RUNNING") throw new HttpError(409, "Only a running campaign can be paused.");
  const updated = await prisma.communicationCampaign.update({ where: { id }, data: { status: "PAUSED", pausedAt: new Date() } });
  await writeAudit({ action: "COMMUNICATION_CAMPAIGN_PAUSED", adminId: actor.id, meta: { campaignId: id } });
  return updated;
}

export async function cancelCampaign(actor: SessionAdmin, id: string, reason: string): Promise<CommunicationCampaign> {
  if (reason.trim().length < 5) throw new HttpError(422, "A reason is required.");
  const c = await load(id);
  if (["COMPLETED", "CANCELLED"].includes(c.status)) throw new HttpError(409, "This campaign has already finished.");
  await prisma.communicationCampaignRecipient.updateMany({ where: { campaignId: id, status: "PENDING" }, data: { status: "SKIPPED", skipReason: "CAMPAIGN_CANCELLED" } });
  // Messages already queued but not yet handed to a provider are cancelled too.
  await prisma.communicationLog.updateMany({ where: { campaignId: id, deliveryStatus: "QUEUED" }, data: { deliveryStatus: "CANCELLED", failureReason: "Campaign cancelled", failedAt: new Date() } });
  const updated = await prisma.communicationCampaign.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
  await writeAudit({ action: "COMMUNICATION_CAMPAIGN_CANCELLED", adminId: actor.id, meta: { campaignId: id, reason: reason.trim().slice(0, 200) } });
  return updated;
}

const MARKETING_FOOTER = "You can stop these messages at any time from Communication Preferences in your dashboard.";

// Sends the next batch of a RUNNING campaign. Every recipient is individually policy-checked; a blocked recipient is SKIPPED with the
// reason (never silently dropped, never force-sent).
export async function processCampaignBatch(campaignId: string, opts: { actor?: SessionAdmin | null; limit?: number } = {}): Promise<{ processed: number; done: boolean }> {
  const c = await load(campaignId);
  if (c.status !== "RUNNING") return { processed: 0, done: false };
  const template = await prisma.communicationTemplate.findUnique({ where: { id: c.templateId } });
  if (!template || template.status !== "ACTIVE") {
    await prisma.communicationCampaign.update({ where: { id: campaignId }, data: { status: "PAUSED", pausedAt: new Date() } });
    return { processed: 0, done: false };
  }
  const batch = await prisma.communicationCampaignRecipient.findMany({ where: { campaignId, status: "PENDING" }, take: opts.limit ?? BATCH_SIZE, orderBy: { createdAt: "asc" } });
  const counters = { queued: 0, sent: 0, skipped: 0, failed: 0 };
  const creator = c.createdById ?? "system";

  for (const r of batch) {
    try {
      const values = await buildTemplateValues(r.profileId);
      let rendered;
      try {
        rendered = renderTemplate({ subject: template.subject, body: template.body, values, allowed: COMMUNICATION_VARIABLES });
      } catch (error) {
        const reason = error instanceof TemplateRenderError ? error.code : "RENDER_ERROR";
        await prisma.communicationCampaignRecipient.update({ where: { id: r.id }, data: { status: "SKIPPED", skipReason: reason } });
        counters.skipped++;
        continue;
      }
      const footer = c.messageType === "MARKETING" ? `\n\n${MARKETING_FOOTER}` : "";
      const text = rendered.text + footer;
      const result = await communicate({
        intent: { recipient: { type: "PROFILE", profileId: r.profileId }, channel: c.channel, messageType: c.messageType, purpose: c.purpose, automated: false, initiatedBy: { adminId: creator, permissions: ["communications:bulk"] } },
        body: text,
        subject: rendered.subject,
        html: toHtmlEmail(text),
        templateParams: template.variables ? rendered.usedVariables.map((v) => values[v as keyof typeof values] ?? "") : [],
        template: { id: template.id, version: template.activeVersion ?? template.currentVersion },
        campaignId,
        createReviewTask: false,
      });
      if (result.status === "BLOCKED") {
        await prisma.communicationCampaignRecipient.update({ where: { id: r.id }, data: { status: "SKIPPED", skipReason: result.blockedCode ?? "BLOCKED", logId: result.logId ?? null } });
        counters.skipped++;
      } else if (result.status === "FAILED") {
        await prisma.communicationCampaignRecipient.update({ where: { id: r.id }, data: { status: "FAILED", logId: result.logId ?? null } });
        counters.failed++;
      } else {
        await prisma.communicationCampaignRecipient.update({ where: { id: r.id }, data: { status: result.status === "SENT" ? "SENT" : "QUEUED", logId: result.logId ?? null } });
        if (result.status === "SENT") counters.sent++;
        else counters.queued++;
      }
    } catch (error) {
      console.error("[communications] campaign recipient failed", error instanceof Error ? error.message : "unknown");
      await prisma.communicationCampaignRecipient.update({ where: { id: r.id }, data: { status: "FAILED", skipReason: "INTERNAL_ERROR" } });
      counters.failed++;
    }
  }

  const remaining = await prisma.communicationCampaignRecipient.count({ where: { campaignId, status: "PENDING" } });
  const eligible = await prisma.communicationCampaignRecipient.count({ where: { campaignId, status: { in: ["QUEUED", "SENT"] } } });
  await prisma.communicationCampaign.update({
    where: { id: campaignId },
    data: {
      queuedCount: { increment: counters.queued },
      sentCount: { increment: counters.sent },
      skippedCount: { increment: counters.skipped },
      failedCount: { increment: counters.failed },
      eligibleCount: eligible,
      ...(remaining === 0 ? { status: "COMPLETED", completedAt: new Date() } : {}),
    },
  });
  if (remaining === 0) await writeAudit({ action: "COMMUNICATION_CAMPAIGN_COMPLETED", adminId: opts.actor?.id ?? null, meta: { campaignId, ...counters } });
  return { processed: batch.length, done: remaining === 0 };
}

// Daily tick: start campaigns whose schedule has arrived and keep RUNNING ones moving.
export async function runCampaignBatches(now = new Date()): Promise<{ started: number; batches: number }> {
  let started = 0;
  let batches = 0;
  const scheduled = await prisma.communicationCampaign.findMany({ where: { status: "SCHEDULED", scheduledAt: { lte: now } }, select: { id: true }, take: 10 });
  for (const s of scheduled) {
    try {
      await startCampaign(null, s.id);
      started++;
    } catch (error) {
      console.error("[communications] scheduled campaign could not start", error instanceof Error ? error.message : "unknown");
    }
  }
  const running = await prisma.communicationCampaign.findMany({ where: { status: "RUNNING" }, select: { id: true }, take: 10 });
  for (const r of running) {
    const out = await processCampaignBatch(r.id);
    if (out.processed > 0) batches++;
  }
  return { started, batches };
}

export async function listCampaigns(take = 100) {
  return prisma.communicationCampaign.findMany({ orderBy: { createdAt: "desc" }, take: Math.min(take, 200) });
}
