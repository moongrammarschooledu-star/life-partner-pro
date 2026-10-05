import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { markApprovalExecuted } from "@/lib/approvals/gate";
import { marketingAudit } from "@/lib/marketing/audit";
import { assertApprovedPayloadMatches, gateMarketingAction } from "@/lib/marketing/approval";
import { canTransitionCampaign, MARKETING_FLAGS, MATERIAL_CAMPAIGN_FIELDS, MAX_BUDGET_MINOR } from "@/lib/marketing/constants";
import { scanMarketingContent } from "@/lib/marketing/content-policy";
import { allowedMarketingHosts } from "@/lib/marketing/hosts";
import { contentHashOf } from "@/lib/marketing/landing-schema";
import { sanitizeUtm } from "@/lib/marketing/attribution";
import { getMarketingAdapter } from "@/lib/marketing/providers/registry";
import type { AdCampaignSpec } from "@/lib/marketing/providers/types";
import type { SessionAdmin } from "@/lib/route-guard";
import type { MarketingCampaign, MarketingChannel, MarketingObjective, MarketingProviderKey, Prisma } from "@prisma/client";

// STEP 29 §4/§30 — campaign lifecycle and launch governance.
//   DRAFT → IN_REVIEW → APPROVED → (SCHEDULED →) ACTIVE ⇄ PAUSED → COMPLETED → ARCHIVED
// ACTIVE is reachable ONLY via launchCampaign()/resumeCampaign(), which re-run every governance check server-side:
// approver ≠ author, fresh content hash, passing policy scan, valid budget, published landing page/form, approved
// creatives, usable provider, and the STEP 19 gate (with a TOCTOU re-check at execution). No frontend-only control.

const OBJECTIVES: MarketingObjective[] = ["LEAD_GENERATION", "WEBSITE_TRAFFIC", "REGISTRATION", "PROFILE_COMPLETION", "VERIFICATION", "MEMBERSHIP_PROMOTION", "REFERRAL_GROWTH", "AWARENESS", "EVENT_PROMOTION", "WHATSAPP_INQUIRY", "CUSTOM"];
const CHANNELS: MarketingChannel[] = ["WEBSITE", "FACEBOOK", "INSTAGRAM", "META_ADS", "WHATSAPP", "TIKTOK", "YOUTUBE", "GOOGLE_ADS", "SEARCH", "EMAIL", "SMS", "REFERRAL", "DIRECT", "EVENT", "OTHER"];
const PROVIDERS: MarketingProviderKey[] = ["SANDBOX", "META", "GOOGLE", "TIKTOK"];
const NEEDS_DESTINATION: MarketingObjective[] = ["LEAD_GENERATION", "REGISTRATION", "WEBSITE_TRAFFIC", "WHATSAPP_INQUIRY"];
const LIVE_STATUSES = ["SCHEDULED", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"] as const;
const KEY_RE = /^[a-z0-9][a-z0-9_-]{2,60}$/;

export interface CampaignInput {
  name: string;
  description?: string | null;
  objective?: MarketingObjective;
  channel?: MarketingChannel;
  providerKey?: MarketingProviderKey;
  campaignKey: string;
  utmSource?: string | null;
  utmMedium?: string | null;
  contentIdentifier?: string | null;
  timezone?: string;
  startAt?: Date | null;
  endAt?: Date | null;
  currencyCode?: string;
  budgetTotalMinor?: number;
  budgetDailyMinor?: number | null;
  alertThresholdPct?: number | null;
  attributionModel?: "FIRST_TOUCH" | "LAST_TOUCH" | null;
  language?: "EN" | "UR";
  landingPageId?: string | null;
  formId?: string | null;
  routingDepartmentId?: string | null;
  assignedTeamId?: string | null;
  responsibleAdminId?: string | null;
  targeting?: unknown;
  notes?: string | null;
}

function intIn(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new HttpError(422, `${name} must be a whole number between ${min} and ${max}.`);
  return value;
}

function plain(value: string | null | undefined, max: number, name: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  const v = value.trim();
  if (v.length > max || /[<>]/.test(v)) throw new HttpError(422, `${name} is invalid or too long.`);
  return v;
}

function validateTargeting(t: unknown): Prisma.InputJsonValue | undefined {
  if (t === undefined || t === null) return undefined;
  if (typeof t !== "object" || Array.isArray(t)) throw new HttpError(422, "Targeting must be an object.");
  if (JSON.stringify(t).length > 4000) throw new HttpError(422, "Targeting is too large.");
  return t as Prisma.InputJsonValue;
}

function validateDates(startAt?: Date | null, endAt?: Date | null) {
  if (startAt && endAt && endAt.getTime() <= startAt.getTime()) throw new HttpError(422, "The end date must be after the start date.");
}

function validateBudget(total: number, daily: number | null | undefined) {
  intIn(total, "Total budget", 0, MAX_BUDGET_MINOR);
  if (daily !== null && daily !== undefined) {
    intIn(daily, "Daily budget", 1, MAX_BUDGET_MINOR);
    if (daily > total) throw new HttpError(422, "The daily budget cannot exceed the total budget.");
  }
}

export async function createCampaign(actor: SessionAdmin, input: CampaignInput): Promise<MarketingCampaign> {
  const name = plain(input.name, 120, "Name");
  if (!name || name.length < 3) throw new HttpError(422, "A campaign name of at least 3 characters is required.");
  const campaignKey = input.campaignKey.trim().toLowerCase();
  if (!KEY_RE.test(campaignKey)) throw new HttpError(422, "Campaign key must be 3–60 lowercase letters, numbers, hyphens or underscores.");
  if (await prisma.marketingCampaign.findUnique({ where: { campaignKey }, select: { id: true } })) throw new HttpError(409, "That campaign key is already in use.");
  const objective = input.objective ?? "LEAD_GENERATION";
  const channel = input.channel ?? "WEBSITE";
  const providerKey = input.providerKey ?? "SANDBOX";
  if (!OBJECTIVES.includes(objective) || !CHANNELS.includes(channel) || !PROVIDERS.includes(providerKey)) throw new HttpError(422, "Invalid objective, channel or provider.");
  const total = input.budgetTotalMinor ?? 0;
  validateBudget(total, input.budgetDailyMinor);
  validateDates(input.startAt, input.endAt);
  const currencyCode = (input.currencyCode ?? "PKR").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currencyCode)) throw new HttpError(422, "Invalid currency code.");
  if (input.alertThresholdPct != null) intIn(input.alertThresholdPct, "Alert threshold", 1, 100);

  const code = await nextSequenceCode("MCAMP");
  const campaign = await prisma.marketingCampaign.create({
    data: {
      code, name, campaignKey, objective, channel, providerKey,
      description: plain(input.description, 1000, "Description"),
      utmSource: sanitizeUtm(input.utmSource) ?? null,
      utmMedium: sanitizeUtm(input.utmMedium) ?? null,
      contentIdentifier: sanitizeUtm(input.contentIdentifier) ?? null,
      timezone: input.timezone?.slice(0, 40) || "Asia/Karachi",
      startAt: input.startAt ?? null, endAt: input.endAt ?? null,
      currencyCode, budgetTotalMinor: total, budgetDailyMinor: input.budgetDailyMinor ?? null,
      alertThresholdPct: input.alertThresholdPct ?? null,
      attributionModel: input.attributionModel ?? null,
      language: input.language === "UR" ? "UR" : "EN",
      landingPageId: input.landingPageId ?? null, formId: input.formId ?? null,
      routingDepartmentId: input.routingDepartmentId ?? null, assignedTeamId: input.assignedTeamId ?? null,
      responsibleAdminId: input.responsibleAdminId ?? actor.id,
      targeting: validateTargeting(input.targeting),
      notes: plain(input.notes, 1000, "Notes"),
      createdById: actor.id,
    },
  });
  await prisma.marketingBudgetEvent.create({ data: { campaignId: campaign.id, type: "SET", amountMinor: total, newMinor: total, currencyCode, actorId: actor.id } });
  await marketingAudit({ action: "MARKETING_CAMPAIGN_CREATED", actorId: actor.id, resource: "campaign", resourceId: campaign.id, after: { code, name, objective, channel, providerKey, budgetTotalMinor: total } });
  return campaign;
}

const NON_MATERIAL_WHEN_LIVE = ["notes", "responsibleAdminId", "assignedTeamId", "routingDepartmentId", "alertThresholdPct", "attributionModel"] as const;

export async function updateCampaign(actor: SessionAdmin, id: string, patch: Partial<CampaignInput>): Promise<MarketingCampaign> {
  const c = await prisma.marketingCampaign.findUnique({ where: { id } });
  if (!c) throw new HttpError(404, "Campaign not found.");
  if (c.status === "ARCHIVED") throw new HttpError(409, "An archived campaign cannot be edited.");

  const touched = Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined);
  const materialTouched = touched.filter((k) => (MATERIAL_CAMPAIGN_FIELDS as readonly string[]).includes(k));
  const live = (LIVE_STATUSES as readonly string[]).includes(c.status);
  if (live && materialTouched.length) throw new HttpError(409, "A launched campaign's core settings cannot be edited. Change the budget through the budget control, or pause it.");

  const data: Prisma.MarketingCampaignUpdateInput = {};
  if (patch.name !== undefined) data.name = plain(patch.name, 120, "Name") ?? c.name;
  if (patch.description !== undefined) data.description = plain(patch.description, 1000, "Description");
  if (patch.objective !== undefined) { if (!OBJECTIVES.includes(patch.objective)) throw new HttpError(422, "Invalid objective."); data.objective = patch.objective; }
  if (patch.channel !== undefined) { if (!CHANNELS.includes(patch.channel)) throw new HttpError(422, "Invalid channel."); data.channel = patch.channel; }
  if (patch.providerKey !== undefined) { if (!PROVIDERS.includes(patch.providerKey)) throw new HttpError(422, "Invalid provider."); data.providerKey = patch.providerKey; }
  if (patch.utmSource !== undefined) data.utmSource = sanitizeUtm(patch.utmSource) ?? null;
  if (patch.utmMedium !== undefined) data.utmMedium = sanitizeUtm(patch.utmMedium) ?? null;
  if (patch.contentIdentifier !== undefined) data.contentIdentifier = sanitizeUtm(patch.contentIdentifier) ?? null;
  if (patch.timezone !== undefined) data.timezone = patch.timezone.slice(0, 40);
  if (patch.startAt !== undefined || patch.endAt !== undefined) {
    const s = patch.startAt !== undefined ? patch.startAt : c.startAt;
    const e = patch.endAt !== undefined ? patch.endAt : c.endAt;
    validateDates(s, e);
    if (patch.startAt !== undefined) data.startAt = patch.startAt;
    if (patch.endAt !== undefined) data.endAt = patch.endAt;
  }
  if (patch.budgetTotalMinor !== undefined || patch.budgetDailyMinor !== undefined) {
    const total = patch.budgetTotalMinor ?? c.budgetTotalMinor;
    const daily = patch.budgetDailyMinor !== undefined ? patch.budgetDailyMinor : c.budgetDailyMinor;
    validateBudget(total, daily);
    data.budgetTotalMinor = total;
    data.budgetDailyMinor = daily;
  }
  if (patch.currencyCode !== undefined) {
    const cc = patch.currencyCode.toUpperCase();
    if (!/^[A-Z]{3}$/.test(cc)) throw new HttpError(422, "Invalid currency code.");
    data.currencyCode = cc;
  }
  if (patch.alertThresholdPct !== undefined) data.alertThresholdPct = patch.alertThresholdPct === null ? null : intIn(patch.alertThresholdPct, "Alert threshold", 1, 100);
  if (patch.attributionModel !== undefined) data.attributionModel = patch.attributionModel;
  if (patch.language !== undefined) data.language = patch.language === "UR" ? "UR" : "EN";
  if (patch.landingPageId !== undefined) data.landingPageId = patch.landingPageId;
  if (patch.formId !== undefined) data.formId = patch.formId;
  if (patch.routingDepartmentId !== undefined) data.routingDepartmentId = patch.routingDepartmentId;
  if (patch.assignedTeamId !== undefined) data.assignedTeamId = patch.assignedTeamId;
  if (patch.responsibleAdminId !== undefined) data.responsibleAdminId = patch.responsibleAdminId;
  if (patch.targeting !== undefined) data.targeting = validateTargeting(patch.targeting) ?? undefined;
  if (patch.notes !== undefined) data.notes = plain(patch.notes, 1000, "Notes");
  void NON_MATERIAL_WHEN_LIVE;

  // A material edit after review/approval invalidates it: back to DRAFT, approval and scan cleared.
  let reset = false;
  if (materialTouched.length && (c.status === "IN_REVIEW" || c.status === "APPROVED")) {
    data.status = "DRAFT";
    data.submittedById = null;
    data.approvedById = null;
    data.approvedAt = null;
    data.contentHash = null;
    data.policyScanAt = null;
    reset = true;
  }
  const updated = await prisma.marketingCampaign.update({ where: { id }, data });
  await marketingAudit({ action: "MARKETING_CAMPAIGN_UPDATED", actorId: actor.id, resource: "campaign", resourceId: id, before: { status: c.status }, after: { fields: touched, status: updated.status, approvalReset: reset } });
  return updated;
}

// ---------- content hash & scan ----------

async function linkedState(c: MarketingCampaign) {
  const [page, form, creatives] = await Promise.all([
    c.landingPageId ? prisma.landingPage.findUnique({ where: { id: c.landingPageId }, select: { status: true, publishedVersionId: true } }) : null,
    c.formId ? prisma.leadForm.findUnique({ where: { id: c.formId }, select: { status: true, publishedVersionId: true } }) : null,
    prisma.marketingCreative.findMany({ where: { campaignId: c.id, status: { not: "ARCHIVED" } }, select: { id: true, status: true, contentHash: true, headline: true, body: true, description: true, ctaLabel: true } }),
  ]);
  return { page, form, creatives };
}

export async function computeCampaignHash(c: MarketingCampaign): Promise<string> {
  const { page, form, creatives } = await linkedState(c);
  const material: Record<string, unknown> = {};
  for (const f of MATERIAL_CAMPAIGN_FIELDS) material[f] = (c as unknown as Record<string, unknown>)[f] ?? null;
  return contentHashOf({ material, page: page?.publishedVersionId ?? null, form: form?.publishedVersionId ?? null, creatives: creatives.map((x) => [x.id, x.contentHash]).sort() });
}

export async function scanCampaign(c: MarketingCampaign) {
  const { creatives } = await linkedState(c);
  const texts = [
    { field: "name", text: c.name },
    ...(c.description ? [{ field: "description", text: c.description }] : []),
    ...(c.notes ? [{ field: "notes", text: c.notes }] : []),
    ...creatives.flatMap((x) => [
      { field: `creative.${x.id}.headline`, text: x.headline },
      { field: `creative.${x.id}.body`, text: x.body },
      ...(x.description ? [{ field: `creative.${x.id}.description`, text: x.description }] : []),
      { field: `creative.${x.id}.cta`, text: x.ctaLabel },
    ]),
  ];
  return scanMarketingContent({ texts, targeting: c.targeting ?? undefined, allowedUrlHosts: allowedMarketingHosts() });
}

// ---------- review ----------

export async function submitCampaignForReview(actor: SessionAdmin, id: string): Promise<MarketingCampaign> {
  const c = await prisma.marketingCampaign.findUnique({ where: { id } });
  if (!c) throw new HttpError(404, "Campaign not found.");
  if (!canTransitionCampaign(c.status, "IN_REVIEW")) throw new HttpError(409, `A ${c.status.toLowerCase()} campaign cannot be submitted for review.`);
  if (c.budgetTotalMinor <= 0) throw new HttpError(422, "Set a total budget before submitting for review.");
  const scan = await scanCampaign(c);
  if (!scan.pass) {
    await marketingAudit({ action: "MARKETING_CONTENT_POLICY_BLOCKED", actorId: actor.id, resource: "campaign", resourceId: id, extra: { rules: scan.findings.filter((f) => f.severity === "BLOCK").map((f) => f.rule) } });
    throw Object.assign(new HttpError(422, "This campaign conflicts with the marketing content policy."), { findings: scan.findings });
  }
  const hash = await computeCampaignHash(c);
  const updated = await prisma.marketingCampaign.update({ where: { id }, data: { status: "IN_REVIEW", submittedById: actor.id, policyScanResult: scan as never, policyScanAt: new Date(), contentHash: hash } });
  await marketingAudit({ action: "MARKETING_CAMPAIGN_SUBMITTED", actorId: actor.id, resource: "campaign", resourceId: id, before: { status: c.status }, after: { status: "IN_REVIEW", contentHash: hash } });
  return updated;
}

export async function approveCampaign(actor: SessionAdmin, id: string, note?: string): Promise<MarketingCampaign> {
  const c = await prisma.marketingCampaign.findUnique({ where: { id } });
  if (!c) throw new HttpError(404, "Campaign not found.");
  if (c.status !== "IN_REVIEW") throw new HttpError(409, "Only a campaign in review can be approved.");
  // Separation of duties, enforced here as well as by the STEP 19 policy: neither the author nor the submitter approves.
  if (actor.id === c.createdById || actor.id === c.submittedById) throw new HttpError(403, "You cannot approve a campaign you created or submitted.");
  const scan = await scanCampaign(c);
  if (!scan.pass) throw Object.assign(new HttpError(422, "This campaign no longer passes the marketing content policy."), { findings: scan.findings });
  const hash = await computeCampaignHash(c);
  if (hash !== c.contentHash) throw new HttpError(409, "The campaign's content changed after it was submitted. It has been returned to the author.");
  const updated = await prisma.marketingCampaign.update({ where: { id }, data: { status: "APPROVED", approvedById: actor.id, approvedAt: new Date(), policyScanResult: scan as never, policyScanAt: new Date() } });
  await marketingAudit({ action: "MARKETING_CAMPAIGN_APPROVED", actorId: actor.id, resource: "campaign", resourceId: id, before: { status: "IN_REVIEW" }, after: { status: "APPROVED", contentHash: hash }, reason: note });
  return updated;
}

export async function rejectCampaign(actor: SessionAdmin, id: string, reason: string): Promise<MarketingCampaign> {
  if (reason.trim().length < 5) throw new HttpError(422, "A reason is required.");
  const c = await prisma.marketingCampaign.findUnique({ where: { id } });
  if (!c) throw new HttpError(404, "Campaign not found.");
  if (c.status !== "IN_REVIEW") throw new HttpError(409, "Only a campaign in review can be rejected.");
  if (actor.id === c.createdById || actor.id === c.submittedById) throw new HttpError(403, "You cannot review a campaign you created or submitted.");
  const updated = await prisma.marketingCampaign.update({ where: { id }, data: { status: "DRAFT", submittedById: null, approvedById: null, approvedAt: null, contentHash: null } });
  await marketingAudit({ action: "MARKETING_CAMPAIGN_REJECTED", actorId: actor.id, resource: "campaign", resourceId: id, before: { status: "IN_REVIEW" }, after: { status: "DRAFT" }, reason });
  return updated;
}

// ---------- launch governance ----------

export interface GovernanceResult {
  ok: boolean;
  failures: string[];
}

// Pure-ish: reads linked state, never writes. Exported so the admin UI can show a launch checklist without launching.
export async function evaluateLaunchGovernance(c: MarketingCampaign, opts: { forResume?: boolean } = {}): Promise<GovernanceResult> {
  const failures: string[] = [];
  if (!(await isFeatureEnabled(MARKETING_FLAGS.master))) failures.push("Marketing is switched off (marketing.enabled).");
  if (!opts.forResume && c.status !== "APPROVED" && c.status !== "SCHEDULED") failures.push("The campaign must be approved first.");
  if (!c.approvedById || c.approvedById === c.createdById || c.approvedById === c.submittedById) failures.push("The campaign has no valid independent approval.");
  if (c.budgetTotalMinor <= 0 || c.budgetTotalMinor > MAX_BUDGET_MINOR) failures.push("The total budget is not valid.");
  if (c.budgetDailyMinor != null && c.budgetDailyMinor > c.budgetTotalMinor) failures.push("The daily budget exceeds the total budget.");
  if (c.spendVerified && c.spendVerifiedMinor >= c.budgetTotalMinor) failures.push("The verified spend has already reached the total budget.");

  const { page, form, creatives } = await linkedState(c);
  if (c.landingPageId && (!page || page.status !== "PUBLISHED" || !page.publishedVersionId)) failures.push("The linked landing page is not published.");
  if (c.formId && (!form || form.status !== "PUBLISHED" || !form.publishedVersionId)) failures.push("The linked lead form is not published.");
  if (NEEDS_DESTINATION.includes(c.objective) && !c.landingPageId && !c.formId) failures.push("This objective needs a landing page or a lead form.");
  if (creatives.some((x) => x.status !== "APPROVED" && x.status !== "ACTIVE" && x.status !== "PAUSED")) failures.push("Every creative must be approved before launch.");

  const scan = await scanCampaign(c);
  if (!scan.pass) failures.push("The campaign conflicts with the marketing content policy.");
  if (!c.contentHash || (await computeCampaignHash(c)) !== c.contentHash) failures.push("The content changed after approval.");

  if (c.providerKey !== "SANDBOX") {
    if (!(await isFeatureEnabled(MARKETING_FLAGS.providerSync))) failures.push("Provider sync is switched off (marketing.provider_sync.enabled).");
    const conn = await prisma.marketingProviderConnection.findUnique({ where: { providerKey: c.providerKey } });
    if (!conn || conn.status !== "CONNECTED") failures.push("The ad provider is not connected.");
    if (getMarketingAdapter(c.providerKey).sandbox) failures.push("Live provider calls are not available in this environment.");
  }
  return { ok: failures.length === 0, failures };
}

function adSpec(c: MarketingCampaign): AdCampaignSpec {
  return { name: c.name, objective: c.objective, totalBudgetMinor: c.budgetTotalMinor, dailyBudgetMinor: c.budgetDailyMinor, currencyCode: c.currencyCode, startAt: c.startAt, endAt: c.endAt, targeting: c.targeting ?? undefined };
}

async function providerCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    console.error("[marketing] provider call failed", e instanceof Error ? e.message : e);
    throw new HttpError(502, "The ad provider rejected or could not complete the request. Nothing was changed.");
  }
}

export type LaunchOutcome = { approvalRequired: false; campaign: MarketingCampaign } | { approvalRequired: true; approvalCode: string; status: string };

export async function launchCampaign(actor: SessionAdmin, id: string, reason: string): Promise<LaunchOutcome> {
  if (reason.trim().length < 5) throw new HttpError(422, "A reason is required.");
  const c = await prisma.marketingCampaign.findUnique({ where: { id } });
  if (!c) throw new HttpError(404, "Campaign not found.");
  const gov = await evaluateLaunchGovernance(c);
  if (!gov.ok) throw Object.assign(new HttpError(422, `This campaign cannot be launched: ${gov.failures[0]}`), { failures: gov.failures });

  const [page, form] = await Promise.all([
    c.landingPageId ? prisma.landingPage.findUnique({ where: { id: c.landingPageId }, select: { publishedVersionId: true } }) : null,
    c.formId ? prisma.leadForm.findUnique({ where: { id: c.formId }, select: { publishedVersionId: true } }) : null,
  ]);
  const payload = { campaignId: c.id, contentHash: c.contentHash, budgetTotalMinor: c.budgetTotalMinor, landingVersionId: page?.publishedVersionId ?? null, formVersionId: form?.publishedVersionId ?? null };
  const gate = await gateMarketingAction({ actionType: "MARKETING_CAMPAIGN_LAUNCH", sourceId: `campaign:${c.id}`, actor, reason, requestedPayload: payload });
  if (gate.requiresApproval && gate.status !== "READY_TO_EXECUTE") return { approvalRequired: true, approvalCode: gate.approvalCode, status: gate.status };
  if (gate.requiresApproval) await assertApprovedPayloadMatches(gate.approvalRequestId, payload);

  const adapter = getMarketingAdapter(c.providerKey);
  const existing = await prisma.marketingAdNode.findFirst({ where: { campaignId: c.id, level: "AD_CAMPAIGN", providerKey: c.providerKey } });
  let externalId = existing?.externalId ?? null;
  if (!externalId) {
    const ref = await providerCall(() => adapter.createCampaign(adSpec(c)));
    externalId = ref.externalId;
    await prisma.marketingAdNode.create({ data: { campaignId: c.id, level: "AD_CAMPAIGN", providerKey: c.providerKey, externalId, name: c.name, status: ref.status, dailyBudgetMinor: c.budgetDailyMinor, lastSyncedAt: new Date() } });
    await marketingAudit({ action: "MARKETING_AD_NODE_SYNCED", actorId: actor.id, resource: "campaign", resourceId: c.id, after: { level: "AD_CAMPAIGN", providerKey: c.providerKey } });
  }

  const now = new Date();
  const future = !!c.startAt && c.startAt.getTime() > now.getTime();
  if (!future) await providerCall(() => adapter.resumeCampaign(externalId as string));
  const updated = await prisma.marketingCampaign.update({ where: { id }, data: { status: future ? "SCHEDULED" : "ACTIVE", launchedAt: future ? null : now, pausedReason: null } });
  if (gate.requiresApproval) await markApprovalExecuted(gate.approvalRequestId, actor.id);
  await marketingAudit({ action: "MARKETING_CAMPAIGN_LAUNCHED", actorId: actor.id, resource: "campaign", resourceId: id, before: { status: c.status }, after: { status: updated.status, providerKey: c.providerKey }, reason, approvalId: gate.requiresApproval ? gate.approvalCode : null });
  return { approvalRequired: false, campaign: updated };
}

async function setProviderState(c: MarketingCampaign, action: "pause" | "resume"): Promise<void> {
  if (c.providerKey === "SANDBOX") return;
  const node = await prisma.marketingAdNode.findFirst({ where: { campaignId: c.id, level: "AD_CAMPAIGN", providerKey: c.providerKey } });
  if (!node?.externalId) return;
  const adapter = getMarketingAdapter(c.providerKey);
  // A pause MUST succeed at the provider: marking it paused locally while the provider keeps spending is the unsafe case.
  await providerCall(() => (action === "pause" ? adapter.pauseCampaign(node.externalId as string) : adapter.resumeCampaign(node.externalId as string)));
  await prisma.marketingAdNode.update({ where: { id: node.id }, data: { status: action === "pause" ? "PAUSED" : "ACTIVE", lastSyncedAt: new Date() } });
}

export async function pauseCampaign(actor: SessionAdmin | null, id: string, reason: string): Promise<MarketingCampaign> {
  if (reason.trim().length < 3) throw new HttpError(422, "A reason is required.");
  const c = await prisma.marketingCampaign.findUnique({ where: { id } });
  if (!c) throw new HttpError(404, "Campaign not found.");
  if (!canTransitionCampaign(c.status, "PAUSED")) throw new HttpError(409, `A ${c.status.toLowerCase()} campaign cannot be paused.`);
  await setProviderState(c, "pause");
  const updated = await prisma.marketingCampaign.update({ where: { id }, data: { status: "PAUSED", pausedReason: reason.slice(0, 200) } });
  await marketingAudit({ action: "MARKETING_CAMPAIGN_PAUSED", actorId: actor?.id ?? null, resource: "campaign", resourceId: id, before: { status: c.status }, after: { status: "PAUSED" }, reason });
  return updated;
}

// Resume re-runs every launch check (content may have changed while paused) but not a new maker-checker round: the
// approval already covered this exact content hash, which the check above re-verifies.
export async function resumeCampaign(actor: SessionAdmin, id: string, reason: string): Promise<MarketingCampaign> {
  if (reason.trim().length < 3) throw new HttpError(422, "A reason is required.");
  const c = await prisma.marketingCampaign.findUnique({ where: { id } });
  if (!c) throw new HttpError(404, "Campaign not found.");
  if (c.status !== "PAUSED") throw new HttpError(409, "Only a paused campaign can be resumed.");
  const gov = await evaluateLaunchGovernance(c, { forResume: true });
  if (!gov.ok) throw Object.assign(new HttpError(422, `This campaign cannot be resumed: ${gov.failures[0]}`), { failures: gov.failures });
  await setProviderState(c, "resume");
  const updated = await prisma.marketingCampaign.update({ where: { id }, data: { status: "ACTIVE", pausedReason: null } });
  await marketingAudit({ action: "MARKETING_CAMPAIGN_RESUMED", actorId: actor.id, resource: "campaign", resourceId: id, before: { status: "PAUSED" }, after: { status: "ACTIVE" }, reason });
  return updated;
}

export async function completeCampaign(actor: SessionAdmin | null, id: string, reason: string): Promise<MarketingCampaign> {
  const c = await prisma.marketingCampaign.findUnique({ where: { id } });
  if (!c) throw new HttpError(404, "Campaign not found.");
  if (!canTransitionCampaign(c.status, "COMPLETED")) throw new HttpError(409, `A ${c.status.toLowerCase()} campaign cannot be completed.`);
  if (c.status === "ACTIVE") await setProviderState(c, "pause");
  const updated = await prisma.marketingCampaign.update({ where: { id }, data: { status: "COMPLETED" } });
  await marketingAudit({ action: "MARKETING_CAMPAIGN_COMPLETED", actorId: actor?.id ?? null, resource: "campaign", resourceId: id, before: { status: c.status }, after: { status: "COMPLETED" }, reason });
  return updated;
}

// Daily tick: a SCHEDULED campaign whose start time has arrived goes live — but only if every governance check STILL
// passes (the approval already covered this content hash; nothing is re-approved or newly authorised here). If any
// check now fails it is parked PAUSED with the reason instead of starting.
export async function startDueScheduledCampaigns(now = new Date()): Promise<{ started: number; parked: number }> {
  const out = { started: 0, parked: 0 };
  const due = await prisma.marketingCampaign.findMany({ where: { status: "SCHEDULED", startAt: { lte: now } }, take: 50 });
  for (const c of due) {
    try {
      const gov = await evaluateLaunchGovernance(c, { forResume: true });
      if (!gov.ok) {
        await prisma.marketingCampaign.update({ where: { id: c.id }, data: { status: "PAUSED", pausedReason: gov.failures[0].slice(0, 200) } });
        await marketingAudit({ action: "MARKETING_CAMPAIGN_PAUSED", actorId: null, resource: "campaign", resourceId: c.id, before: { status: "SCHEDULED" }, after: { status: "PAUSED" }, reason: gov.failures[0] });
        out.parked++;
        continue;
      }
      await setProviderState(c, "resume");
      await prisma.marketingCampaign.update({ where: { id: c.id }, data: { status: "ACTIVE", launchedAt: now, pausedReason: null } });
      await marketingAudit({ action: "MARKETING_CAMPAIGN_LAUNCHED", actorId: null, resource: "campaign", resourceId: c.id, before: { status: "SCHEDULED" }, after: { status: "ACTIVE" }, reason: "Scheduled start reached" });
      out.started++;
    } catch (e) {
      console.error("[marketing] scheduled start failed", e instanceof Error ? e.message : e);
    }
  }
  return out;
}

export async function completeEndedCampaigns(now = new Date()): Promise<number> {
  const ended = await prisma.marketingCampaign.findMany({ where: { status: { in: ["ACTIVE", "PAUSED"] }, endAt: { lte: now } }, select: { id: true }, take: 50 });
  let n = 0;
  for (const c of ended) {
    try {
      await completeCampaign(null, c.id, "End date reached");
      n++;
    } catch (e) {
      console.error("[marketing] auto-complete failed", e instanceof Error ? e.message : e);
    }
  }
  return n;
}

export async function archiveCampaign(actor: SessionAdmin, id: string, reason: string): Promise<MarketingCampaign> {
  if (reason.trim().length < 5) throw new HttpError(422, "A reason is required.");
  const c = await prisma.marketingCampaign.findUnique({ where: { id } });
  if (!c) throw new HttpError(404, "Campaign not found.");
  if (!canTransitionCampaign(c.status, "ARCHIVED")) throw new HttpError(409, `A ${c.status.toLowerCase()} campaign cannot be archived.`);
  const updated = await prisma.marketingCampaign.update({ where: { id }, data: { status: "ARCHIVED" } });
  await marketingAudit({ action: "MARKETING_CAMPAIGN_ARCHIVED", actorId: actor.id, resource: "campaign", resourceId: id, before: { status: c.status }, after: { status: "ARCHIVED" }, reason });
  return updated;
}
