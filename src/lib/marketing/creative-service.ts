import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { marketingAudit } from "@/lib/marketing/audit";
import { canTransitionCreative } from "@/lib/marketing/constants";
import { scanMarketingContent } from "@/lib/marketing/content-policy";
import { allowedMarketingHosts } from "@/lib/marketing/hosts";
import { contentHashOf } from "@/lib/marketing/landing-schema";
import type { SessionAdmin } from "@/lib/route-guard";
import type { MarketingCreative, MarketingCreativeStatus } from "@prisma/client";

// STEP 29 §8 — ad creatives (text + an asset REFERENCE; there is no ad-image upload pipeline). Reviewed under the same
// no-self-approval rule as pages; a creative edited after approval returns to DRAFT, which changes its content hash
// and so invalidates the owning campaign's approval until that is re-approved.

export interface CreativeInput {
  campaignId?: string | null;
  name: string;
  headline: string;
  body: string;
  description?: string | null;
  ctaLabel: string;
  language?: "EN" | "UR";
  assetKey?: string | null;
}

function text(v: string | null | undefined, min: number, max: number, name: string): string {
  const t = (v ?? "").trim();
  if (t.length < min || t.length > max || /[<>]/.test(t)) throw new HttpError(422, `${name} must be ${min}–${max} plain-text characters.`);
  return t;
}

function normalize(input: CreativeInput) {
  const assetKey = input.assetKey?.trim() || null;
  if (assetKey && !/^[A-Za-z0-9/_.-]{1,200}$/.test(assetKey)) throw new HttpError(422, "Asset key contains invalid characters.");
  const n = {
    name: text(input.name, 3, 120, "Name"),
    headline: text(input.headline, 3, 120, "Headline"),
    body: text(input.body, 3, 600, "Primary text"),
    description: input.description ? text(input.description, 1, 300, "Description") : null,
    ctaLabel: text(input.ctaLabel, 2, 40, "Call to action"),
    language: input.language === "UR" ? ("UR" as const) : ("EN" as const),
    assetKey,
  };
  return { ...n, contentHash: contentHashOf({ h: n.headline, b: n.body, d: n.description, c: n.ctaLabel, l: n.language, a: n.assetKey }) };
}

function scanOf(c: { headline: string; body: string; description: string | null; ctaLabel: string }) {
  return scanMarketingContent({
    texts: [{ field: "headline", text: c.headline }, { field: "body", text: c.body }, ...(c.description ? [{ field: "description", text: c.description }] : []), { field: "cta", text: c.ctaLabel }],
    allowedUrlHosts: allowedMarketingHosts(),
  });
}

export async function createCreative(actor: SessionAdmin, input: CreativeInput): Promise<MarketingCreative> {
  const n = normalize(input);
  const code = await nextSequenceCode("MCRE");
  const creative = await prisma.marketingCreative.create({ data: { code, campaignId: input.campaignId ?? null, ...n, createdById: actor.id } });
  await marketingAudit({ action: "MARKETING_CREATIVE_CHANGED", actorId: actor.id, resource: "creative", resourceId: creative.id, after: { code, status: "DRAFT" } });
  return creative;
}

export async function editCreative(actor: SessionAdmin, id: string, input: CreativeInput): Promise<MarketingCreative> {
  const c = await prisma.marketingCreative.findUnique({ where: { id } });
  if (!c) throw new HttpError(404, "Creative not found.");
  if (c.status !== "DRAFT" && c.status !== "REJECTED" && c.status !== "APPROVED") throw new HttpError(409, `A ${c.status.toLowerCase()} creative cannot be edited.`);
  const n = normalize(input);
  const updated = await prisma.marketingCreative.update({ where: { id }, data: { ...n, status: "DRAFT", approvedById: null, rejectReason: null, policyScanResult: undefined } });
  await marketingAudit({ action: "MARKETING_CREATIVE_CHANGED", actorId: actor.id, resource: "creative", resourceId: id, before: { status: c.status, contentHash: c.contentHash }, after: { status: "DRAFT", contentHash: n.contentHash } });
  return updated;
}

async function move(id: string, to: MarketingCreativeStatus): Promise<MarketingCreative> {
  const c = await prisma.marketingCreative.findUnique({ where: { id } });
  if (!c) throw new HttpError(404, "Creative not found.");
  if (!canTransitionCreative(c.status, to)) throw new HttpError(409, `A ${c.status.toLowerCase()} creative cannot become ${to.toLowerCase()}.`);
  return prisma.marketingCreative.update({ where: { id }, data: { status: to } });
}

export async function submitCreative(actor: SessionAdmin, id: string): Promise<MarketingCreative> {
  const c = await prisma.marketingCreative.findUnique({ where: { id } });
  if (!c) throw new HttpError(404, "Creative not found.");
  if (!canTransitionCreative(c.status, "REVIEW")) throw new HttpError(409, `A ${c.status.toLowerCase()} creative cannot be submitted.`);
  const scan = scanOf(c);
  if (!scan.pass) {
    await marketingAudit({ action: "MARKETING_CONTENT_POLICY_BLOCKED", actorId: actor.id, resource: "creative", resourceId: id, extra: { rules: scan.findings.filter((f) => f.severity === "BLOCK").map((f) => f.rule) } });
    throw Object.assign(new HttpError(422, "This creative conflicts with the marketing content policy."), { findings: scan.findings });
  }
  const updated = await prisma.marketingCreative.update({ where: { id }, data: { status: "REVIEW", policyScanResult: scan as never } });
  await marketingAudit({ action: "MARKETING_CREATIVE_CHANGED", actorId: actor.id, resource: "creative", resourceId: id, after: { status: "REVIEW" } });
  return updated;
}

export async function reviewCreative(actor: SessionAdmin, id: string, decision: "APPROVE" | "REJECT", reason?: string): Promise<MarketingCreative> {
  const c = await prisma.marketingCreative.findUnique({ where: { id } });
  if (!c) throw new HttpError(404, "Creative not found.");
  if (c.status !== "REVIEW") throw new HttpError(409, "Only a creative in review can be decided.");
  if (c.createdById === actor.id) throw new HttpError(403, "You cannot review a creative you created.");
  if (decision === "REJECT") {
    if (!reason || reason.trim().length < 5) throw new HttpError(422, "A reason is required.");
    const rejected = await prisma.marketingCreative.update({ where: { id }, data: { status: "REJECTED", rejectReason: reason.trim().slice(0, 300) } });
    await marketingAudit({ action: "MARKETING_CREATIVE_CHANGED", actorId: actor.id, resource: "creative", resourceId: id, after: { status: "REJECTED" }, reason });
    return rejected;
  }
  const scan = scanOf(c);
  if (!scan.pass) throw Object.assign(new HttpError(422, "This creative no longer passes the marketing content policy."), { findings: scan.findings });
  const approved = await prisma.marketingCreative.update({ where: { id }, data: { status: "APPROVED", approvedById: actor.id, policyScanResult: scan as never } });
  await marketingAudit({ action: "MARKETING_CREATIVE_APPROVED", actorId: actor.id, resource: "creative", resourceId: id, after: { status: "APPROVED", contentHash: c.contentHash }, reason });
  return approved;
}

export async function setCreativeStatus(actor: SessionAdmin, id: string, to: "ACTIVE" | "PAUSED" | "ARCHIVED"): Promise<MarketingCreative> {
  const updated = await move(id, to);
  await marketingAudit({ action: "MARKETING_CREATIVE_CHANGED", actorId: actor.id, resource: "creative", resourceId: id, after: { status: to } });
  return updated;
}
