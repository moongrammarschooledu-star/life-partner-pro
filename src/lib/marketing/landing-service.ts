import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { marketingAudit } from "@/lib/marketing/audit";
import { assertApprovedPayloadMatches, gateMarketingAction } from "@/lib/marketing/approval";
import { markApprovalExecuted } from "@/lib/approvals/gate";
import { canTransitionContentVersion } from "@/lib/marketing/constants";
import { scanMarketingContent } from "@/lib/marketing/content-policy";
import { allowedMarketingHosts, marketingBaseUrl } from "@/lib/marketing/hosts";
import { collectLandingTexts, contentHashOf, landingDisclosures, parseLandingSections, type LandingSection } from "@/lib/marketing/landing-schema";
import { sanitizeHttpsUrl } from "@/lib/marketing/url";
import type { SessionAdmin } from "@/lib/route-guard";
import type { LandingPage, LandingPageVersion } from "@prisma/client";

// STEP 29 §9–§11 — landing pages with immutable-once-approved versions. Every state change is audited. Content is
// structured JSON (no raw HTML). Publishing and rollback follow the STEP 25 template pattern: no self-review, a
// content-policy scan bound to the content hash, and the STEP 19 gate for publishing. Rollback clones an older
// version FORWARD as a new draft that re-enters review (so it is re-validated against today's policy).

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED_SLUGS = new Set(["admin", "api", "lp", "login", "register", "pricing", "dashboard", "support", "terms", "privacy-policy"]);

export interface LandingContentInput {
  title: string;
  metaDescription?: string | null;
  canonicalUrl?: string | null;
  ogTitle?: string | null;
  ogDescription?: string | null;
  socialImageUrl?: string | null;
  sections: unknown;
  changeSummary?: string | null;
}

function validateSlug(slug: string): string {
  const s = slug.trim().toLowerCase();
  if (s.length < 3 || s.length > 60 || !SLUG_RE.test(s)) throw new HttpError(422, "Slug must be 3–60 lowercase letters, numbers and single hyphens.");
  if (RESERVED_SLUGS.has(s)) throw new HttpError(422, "That slug is reserved.");
  return s;
}

function shortText(value: string | null | undefined, max: number, name: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  const v = value.trim();
  if (v.length > max || /[<>]/.test(v)) throw new HttpError(422, `${name} is invalid or too long.`);
  return v;
}

function normalizeContent(input: LandingContentInput) {
  const title = shortText(input.title, 160, "Title");
  if (!title) throw new HttpError(422, "A title is required.");
  const sections = parseLandingSections(input.sections);
  const canonicalUrl = input.canonicalUrl ? sanitizeHttpsUrl(input.canonicalUrl, allowedMarketingHosts()) : null;
  if (input.canonicalUrl && !canonicalUrl) throw new HttpError(422, "Canonical URL must be an https URL on this site's own host.");
  const socialImageUrl = input.socialImageUrl ? sanitizeHttpsUrl(input.socialImageUrl, allowedMarketingHosts()) : null;
  if (input.socialImageUrl && !socialImageUrl) throw new HttpError(422, "Social image must be an https URL on this site's own host.");
  return {
    title,
    metaDescription: shortText(input.metaDescription, 300, "Meta description"),
    canonicalUrl,
    ogTitle: shortText(input.ogTitle, 160, "Open Graph title"),
    ogDescription: shortText(input.ogDescription, 300, "Open Graph description"),
    socialImageUrl,
    sections,
    changeSummary: shortText(input.changeSummary, 300, "Change summary"),
  };
}

function hashFor(c: ReturnType<typeof normalizeContent>): string {
  return contentHashOf({ t: c.title, d: c.metaDescription, c: c.canonicalUrl, ot: c.ogTitle, od: c.ogDescription, i: c.socialImageUrl, s: c.sections });
}

export async function createLandingPage(actor: SessionAdmin, input: LandingContentInput & { name: string; slug: string; language?: string; campaignId?: string | null; sitemapInclude?: boolean; noindex?: boolean }) {
  const slug = validateSlug(input.slug);
  const name = shortText(input.name, 120, "Name");
  if (!name) throw new HttpError(422, "A name is required.");
  if (await prisma.landingPage.findUnique({ where: { slug }, select: { id: true } })) throw new HttpError(409, "That slug is already in use.");
  const content = normalizeContent(input);
  const code = await nextSequenceCode("LP");
  const page = await prisma.landingPage.create({
    data: {
      code, slug, name,
      language: input.language === "UR" ? "UR" : "EN",
      sitemapInclude: input.sitemapInclude ?? false,
      noindex: input.noindex ?? true,
      campaignId: input.campaignId ?? null,
      createdById: actor.id,
      versions: { create: { version: 1, status: "DRAFT", ...content, sections: content.sections as never, contentHash: hashFor(content), authorId: actor.id } },
    },
    include: { versions: true },
  });
  await marketingAudit({ action: "MARKETING_LANDING_VERSION_CREATED", actorId: actor.id, resource: "landing_page", resourceId: page.id, after: { code, slug, version: 1 } });
  return page;
}

async function loadVersion(pageId: string, version: number): Promise<{ page: LandingPage; v: LandingPageVersion }> {
  const page = await prisma.landingPage.findUnique({ where: { id: pageId } });
  if (!page) throw new HttpError(404, "Landing page not found.");
  const v = await prisma.landingPageVersion.findUnique({ where: { pageId_version: { pageId, version } } });
  if (!v) throw new HttpError(404, "Version not found.");
  return { page, v };
}

// A DRAFT (or REJECTED, which returns to DRAFT) version is edited in place; editing anything else starts a new version.
export async function saveLandingDraft(actor: SessionAdmin, pageId: string, input: LandingContentInput): Promise<LandingPageVersion> {
  const page = await prisma.landingPage.findUnique({ where: { id: pageId }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
  if (!page) throw new HttpError(404, "Landing page not found.");
  if (page.status === "ARCHIVED") throw new HttpError(409, "An archived page cannot be edited.");
  const latest = page.versions[0];
  const content = normalizeContent(input);
  const data = { ...content, sections: content.sections as never, contentHash: hashFor(content) };
  if (latest && (latest.status === "DRAFT" || latest.status === "REJECTED")) {
    const updated = await prisma.landingPageVersion.update({ where: { id: latest.id }, data: { ...data, status: "DRAFT", authorId: actor.id, reviewerId: null, reviewedAt: null } });
    await marketingAudit({ action: "MARKETING_LANDING_VERSION_CREATED", actorId: actor.id, resource: "landing_page", resourceId: pageId, after: { version: updated.version, edited: true } });
    return updated;
  }
  const next = (latest?.version ?? 0) + 1;
  const created = await prisma.landingPageVersion.create({ data: { pageId, version: next, status: "DRAFT", ...data, authorId: actor.id } });
  await marketingAudit({ action: "MARKETING_LANDING_VERSION_CREATED", actorId: actor.id, resource: "landing_page", resourceId: pageId, after: { version: next } });
  return created;
}

function scanVersion(v: { title: string; metaDescription: string | null; ogTitle: string | null; ogDescription: string | null; sections: unknown }, sections: LandingSection[]) {
  return scanMarketingContent({
    texts: [
      { field: "title", text: v.title },
      ...(v.metaDescription ? [{ field: "metaDescription", text: v.metaDescription }] : []),
      ...(v.ogTitle ? [{ field: "ogTitle", text: v.ogTitle }] : []),
      ...(v.ogDescription ? [{ field: "ogDescription", text: v.ogDescription }] : []),
      ...collectLandingTexts(sections),
    ],
    allowedUrlHosts: allowedMarketingHosts(),
    requiredDisclosures: landingDisclosures(sections),
  });
}

export async function submitLandingVersion(actor: SessionAdmin, pageId: string, version: number) {
  const { v } = await loadVersion(pageId, version);
  if (!canTransitionContentVersion(v.status, "REVIEW")) throw new HttpError(409, `A ${v.status.toLowerCase()} version cannot be submitted for review.`);
  const sections = parseLandingSections(v.sections);
  const scan = scanVersion(v, sections);
  if (!scan.pass) {
    await marketingAudit({ action: "MARKETING_CONTENT_POLICY_BLOCKED", actorId: actor.id, resource: "landing_page", resourceId: pageId, extra: { version, rules: scan.findings.filter((f) => f.severity === "BLOCK").map((f) => f.rule) } });
    throw Object.assign(new HttpError(422, "This page cannot be submitted: it conflicts with the marketing content policy."), { findings: scan.findings });
  }
  return prisma.landingPageVersion.update({ where: { id: v.id }, data: { status: "REVIEW", policyScanResult: scan as never, contentHash: v.contentHash } });
}

export async function reviewLandingVersion(actor: SessionAdmin, pageId: string, version: number, decision: "APPROVE" | "REJECT", note?: string) {
  const { v } = await loadVersion(pageId, version);
  if (v.status !== "REVIEW") throw new HttpError(409, "Only a version in review can be decided.");
  if (v.authorId === actor.id) throw new HttpError(403, "You cannot review a version you authored.");
  if (decision === "REJECT") {
    const rejected = await prisma.landingPageVersion.update({ where: { id: v.id }, data: { status: "REJECTED", reviewerId: actor.id, reviewedAt: new Date() } });
    await marketingAudit({ action: "MARKETING_LANDING_VERSION_CREATED", actorId: actor.id, resource: "landing_page", resourceId: pageId, after: { version, status: "REJECTED" }, reason: note });
    return rejected;
  }
  // The scan is re-run at approval so an updated policy applies to content submitted earlier.
  const sections = parseLandingSections(v.sections);
  const scan = scanVersion(v, sections);
  if (!scan.pass) throw Object.assign(new HttpError(422, "This version no longer passes the marketing content policy."), { findings: scan.findings });
  const approved = await prisma.landingPageVersion.update({ where: { id: v.id }, data: { status: "APPROVED", reviewerId: actor.id, reviewedAt: new Date(), policyScanResult: scan as never } });
  await marketingAudit({ action: "MARKETING_LANDING_VERSION_CREATED", actorId: actor.id, resource: "landing_page", resourceId: pageId, after: { version, status: "APPROVED" }, reason: note });
  return approved;
}

export type PublishOutcome = { approvalRequired: false; version: LandingPageVersion } | { approvalRequired: true; approvalCode: string; status: string };

export async function publishLandingVersion(actor: SessionAdmin, pageId: string, version: number, reason: string): Promise<PublishOutcome> {
  const { page, v } = await loadVersion(pageId, version);
  if (page.status === "ARCHIVED") throw new HttpError(409, "An archived page cannot be published.");
  if (v.status !== "APPROVED") throw new HttpError(409, "Only an approved version can be published.");
  const sections = parseLandingSections(v.sections);

  // Every embedded form must itself be published, otherwise the live page would show a dead form.
  for (const s of sections) {
    if (s.type !== "FORM_EMBED") continue;
    const form = await prisma.leadForm.findUnique({ where: { id: s.formId }, select: { status: true, publishedVersionId: true } });
    if (!form || form.status !== "PUBLISHED" || !form.publishedVersionId) throw new HttpError(409, "A form embedded in this page is not published.");
  }

  const gate = await gateMarketingAction({
    actionType: "MARKETING_LANDING_PAGE_PUBLISH",
    sourceId: `landing:${pageId}:v${version}`,
    actor,
    reason,
    requestedPayload: { pageId, version, contentHash: v.contentHash },
  });
  if (gate.requiresApproval && gate.status !== "READY_TO_EXECUTE") return { approvalRequired: true, approvalCode: gate.approvalCode, status: gate.status };
  if (gate.requiresApproval) await assertApprovedPayloadMatches(gate.approvalRequestId, { pageId, version, contentHash: v.contentHash });

  const now = new Date();
  const published = await prisma.$transaction(async (tx) => {
    if (page.publishedVersionId && page.publishedVersionId !== v.id) {
      await tx.landingPageVersion.update({ where: { id: page.publishedVersionId }, data: { status: "SUPERSEDED" } });
    }
    await tx.landingPage.update({ where: { id: pageId }, data: { status: "PUBLISHED", publishedVersionId: v.id } });
    return tx.landingPageVersion.update({ where: { id: v.id }, data: { publishedAt: now } });
  });
  if (gate.requiresApproval) await markApprovalExecuted(gate.approvalRequestId, actor.id);
  await marketingAudit({ action: "MARKETING_LANDING_PUBLISHED", actorId: actor.id, resource: "landing_page", resourceId: pageId, before: { publishedVersionId: page.publishedVersionId }, after: { publishedVersionId: v.id, version }, reason, approvalId: gate.requiresApproval ? gate.approvalCode : null });
  return { approvalRequired: false, version: published };
}

export async function unpublishLandingPage(actor: SessionAdmin, pageId: string, reason: string): Promise<LandingPage> {
  const page = await prisma.landingPage.findUnique({ where: { id: pageId } });
  if (!page) throw new HttpError(404, "Landing page not found.");
  if (page.status !== "PUBLISHED") throw new HttpError(409, "The page is not published.");
  if (reason.trim().length < 5) throw new HttpError(422, "A reason is required.");
  const updated = await prisma.landingPage.update({ where: { id: pageId }, data: { status: "UNPUBLISHED" } });
  await marketingAudit({ action: "MARKETING_LANDING_UNPUBLISHED", actorId: actor.id, resource: "landing_page", resourceId: pageId, before: { status: "PUBLISHED" }, after: { status: "UNPUBLISHED" }, reason });
  return updated;
}

// Rollback = clone an earlier APPROVED/SUPERSEDED version forward as a NEW DRAFT. It must be reviewed and published
// again, so the restored content is re-checked against today's content policy and the live page never silently changes.
export async function rollbackLandingPage(actor: SessionAdmin, pageId: string, fromVersion: number, reason: string): Promise<LandingPageVersion> {
  if (reason.trim().length < 5) throw new HttpError(422, "A reason is required.");
  const { v } = await loadVersion(pageId, fromVersion);
  if (v.status !== "APPROVED" && v.status !== "SUPERSEDED") throw new HttpError(409, "Only a previously approved version can be restored.");
  const latest = await prisma.landingPageVersion.findFirst({ where: { pageId }, orderBy: { version: "desc" }, select: { version: true } });
  const clone = await prisma.landingPageVersion.create({
    data: {
      pageId, version: (latest?.version ?? 0) + 1, status: "DRAFT",
      title: v.title, metaDescription: v.metaDescription, canonicalUrl: v.canonicalUrl, ogTitle: v.ogTitle, ogDescription: v.ogDescription,
      socialImageUrl: v.socialImageUrl, sections: v.sections as never, contentHash: v.contentHash,
      changeSummary: `Restored from version ${fromVersion}: ${reason.trim().slice(0, 200)}`, clonedFromVersionId: v.id, authorId: actor.id,
    },
  });
  await marketingAudit({ action: "MARKETING_LANDING_ROLLED_BACK", actorId: actor.id, resource: "landing_page", resourceId: pageId, after: { fromVersion, newVersion: clone.version }, reason });
  return clone;
}

export async function archiveLandingPage(actor: SessionAdmin, pageId: string, reason: string): Promise<LandingPage> {
  const page = await prisma.landingPage.findUnique({ where: { id: pageId } });
  if (!page) throw new HttpError(404, "Landing page not found.");
  if (reason.trim().length < 5) throw new HttpError(422, "A reason is required.");
  const updated = await prisma.landingPage.update({ where: { id: pageId }, data: { status: "ARCHIVED", publishedVersionId: null } });
  await marketingAudit({ action: "MARKETING_LANDING_UNPUBLISHED", actorId: actor.id, resource: "landing_page", resourceId: pageId, before: { status: page.status }, after: { status: "ARCHIVED" }, reason });
  return updated;
}

// Public read: only a PUBLISHED page with a published version, never a draft/other version.
export async function getPublishedLandingPage(slug: string): Promise<{ page: LandingPage; version: LandingPageVersion; sections: LandingSection[]; canonicalBase: string | null } | null> {
  const page = await prisma.landingPage.findUnique({ where: { slug } });
  if (!page || page.status !== "PUBLISHED" || !page.publishedVersionId) return null;
  const version = await prisma.landingPageVersion.findUnique({ where: { id: page.publishedVersionId } });
  if (!version || version.status !== "APPROVED" || !version.publishedAt) return null;
  return { page, version, sections: parseLandingSections(version.sections), canonicalBase: marketingBaseUrl() };
}
