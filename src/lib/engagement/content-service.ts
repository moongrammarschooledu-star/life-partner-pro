import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { markApprovalExecuted } from "@/lib/approvals/gate";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { engagementAudit } from "@/lib/engagement/audit";
import { assertApprovedPayloadMatches, gateEngagementAction } from "@/lib/engagement/approval";
import { scanEngagementContent } from "@/lib/engagement/content-scan";
import { GUIDE_CATEGORIES } from "@/lib/engagement/constants";
import type { SessionAdmin } from "@/lib/route-guard";
import type { EngagementContentVersion } from "@prisma/client";

// STEP 30 — education / guidance centre. Plain-text articles only (no HTML anywhere), written in English or Urdu, versioned:
//   version DRAFT -> REVIEW -> APPROVED -> (published through the STEP 19 gate)   /   REJECTED / SUPERSEDED
//   content DRAFT -> REVIEW -> PUBLISHED <-> UNPUBLISHED -> ARCHIVED
// Same governance as the marketing landing pages: the reviewer is never the author and the approval is bound to the content hash.

export interface ContentInput {
  title: string;
  description?: string | null;
  body: string;
  language?: string;
  authorName?: string | null;
  imageUrl?: string | null;
}

const EDITABLE: Array<EngagementContentVersion["status"]> = ["DRAFT", "REJECTED"];
const TAG_LIKE = /<\s*\/?\s*[a-z!][^>]*>/i;

function clean(input: ContentInput) {
  const title = (input.title ?? "").trim();
  const body = (input.body ?? "").trim();
  const description = input.description?.trim() || null;
  const language = (input.language ?? "EN").toUpperCase();
  if (title.length < 3 || title.length > 160) throw new HttpError(422, "A title of 3-160 characters is required.");
  if (body.length < 20 || body.length > 20_000) throw new HttpError(422, "The article body must be 20-20,000 characters.");
  if (description && description.length > 300) throw new HttpError(422, "The summary is too long.");
  if (language !== "EN" && language !== "UR") throw new HttpError(422, "Language must be EN or UR.");
  if ([title, body, description ?? ""].some((t) => TAG_LIKE.test(t))) throw new HttpError(422, "HTML is not allowed. Use plain text.");
  const authorName = input.authorName?.trim() || null;
  if (authorName && (authorName.length > 80 || TAG_LIKE.test(authorName))) throw new HttpError(422, "The author name is invalid.");
  let imageUrl: string | null = null;
  if (input.imageUrl) {
    if (!/^https:\/\/[^\s]+$/i.test(input.imageUrl) || input.imageUrl.length > 500) throw new HttpError(422, "The image must be a https link.");
    imageUrl = input.imageUrl;
  }
  return { title, body, description, language, authorName, imageUrl };
}

export function contentHash(c: { title: string; description: string | null; body: string; language: string; imageUrl: string | null }): string {
  return createHash("sha256").update(JSON.stringify([c.title, c.description, c.body, c.language, c.imageUrl])).digest("hex");
}

function slugOk(slug: string): string {
  const s = slug.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/.test(s)) throw new HttpError(422, "The slug may only use lowercase letters, numbers and hyphens (3-80 characters).");
  return s;
}

function textsOf(c: { title: string; description: string | null; body: string }) {
  return [{ field: "title", text: c.title }, { field: "description", text: c.description ?? "" }, { field: "body", text: c.body }];
}

export async function createContent(actor: SessionAdmin, input: ContentInput & { slug: string; category: string }) {
  if (!(GUIDE_CATEGORIES as readonly string[]).includes(input.category)) throw new HttpError(422, "Unknown category.");
  const slug = slugOk(input.slug);
  const c = clean(input);
  if (await prisma.engagementContent.findUnique({ where: { slug }, select: { id: true } })) throw new HttpError(409, "That slug is already used.");
  const code = await nextSequenceCode("ECN");
  const row = await prisma.engagementContent.create({
    data: { code, slug, category: input.category, createdById: actor.id, versions: { create: { version: 1, status: "DRAFT", ...c, contentHash: contentHash(c), authorId: actor.id } } },
  });
  await engagementAudit({ action: "ENGAGEMENT_CONTENT_CHANGED", actorId: actor.id, resource: "engagement_content", resourceId: row.id, after: { code, slug } });
  return row;
}

export async function saveContentDraft(actor: SessionAdmin, id: string, input: ContentInput) {
  const content = await prisma.engagementContent.findUnique({ where: { id }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
  if (!content) throw new HttpError(404, "Article not found.");
  if (content.status === "ARCHIVED") throw new HttpError(409, "An archived article cannot be edited.");
  const c = clean(input);
  const latest = content.versions[0];
  let version: EngagementContentVersion;
  if (latest && EDITABLE.includes(latest.status)) {
    version = await prisma.engagementContentVersion.update({ where: { id: latest.id }, data: { ...c, contentHash: contentHash(c), status: "DRAFT", policyScanResult: undefined, authorId: actor.id, reviewerId: null, reviewedAt: null } });
  } else {
    version = await prisma.engagementContentVersion.create({ data: { contentId: id, version: (latest?.version ?? 0) + 1, status: "DRAFT", ...c, contentHash: contentHash(c), authorId: actor.id } });
    await prisma.engagementContent.update({ where: { id }, data: { currentVersion: version.version } });
  }
  await engagementAudit({ action: "ENGAGEMENT_CONTENT_CHANGED", actorId: actor.id, resource: "engagement_content", resourceId: id, after: { version: version.version } });
  return version;
}

async function getVersion(contentId: string, version: number) {
  const v = await prisma.engagementContentVersion.findUnique({ where: { contentId_version: { contentId, version } } });
  if (!v) throw new HttpError(404, "Version not found.");
  return v;
}

export async function submitContentVersion(actor: SessionAdmin, id: string, version: number) {
  const v = await getVersion(id, version);
  if (!EDITABLE.includes(v.status)) throw new HttpError(409, "Only a draft can be submitted for review.");
  const scan = scanEngagementContent({ texts: textsOf(v) });
  if (!scan.pass) {
    await engagementAudit({ action: "ENGAGEMENT_CONTENT_POLICY_BLOCKED", actorId: actor.id, resource: "engagement_content", resourceId: id, extra: { rules: scan.findings.filter((f) => f.severity === "BLOCK").map((f) => f.rule) } });
    throw Object.assign(new HttpError(422, "This article conflicts with the engagement content policy."), { findings: scan.findings });
  }
  const updated = await prisma.engagementContentVersion.update({ where: { id: v.id }, data: { status: "REVIEW", policyScanResult: scan as never } });
  await prisma.engagementContent.updateMany({ where: { id, status: "DRAFT" }, data: { status: "REVIEW" } });
  return updated;
}

export async function reviewContentVersion(actor: SessionAdmin, id: string, version: number, decision: "APPROVE" | "REJECT", note?: string) {
  const v = await getVersion(id, version);
  if (v.status !== "REVIEW") throw new HttpError(409, "Only a version in review can be decided.");
  if (actor.id === v.authorId) throw new HttpError(403, "You cannot review an article you wrote.");
  if (decision === "REJECT" && (note ?? "").trim().length < 5) throw new HttpError(422, "A reason is required to reject.");
  const updated = await prisma.engagementContentVersion.update({ where: { id: v.id }, data: { status: decision === "APPROVE" ? "APPROVED" : "REJECTED", reviewerId: actor.id, reviewedAt: new Date() } });
  await engagementAudit({ action: "ENGAGEMENT_CONTENT_CHANGED", actorId: actor.id, resource: "engagement_content", resourceId: id, after: { version, decision }, reason: note });
  return updated;
}

export type ContentPublishOutcome = { approvalRequired: false } | { approvalRequired: true; approvalCode: string; status: string };

export async function publishContentVersion(actor: SessionAdmin, id: string, version: number, reason: string): Promise<ContentPublishOutcome> {
  if (reason.trim().length < 5) throw new HttpError(422, "A reason is required.");
  const content = await prisma.engagementContent.findUnique({ where: { id } });
  if (!content) throw new HttpError(404, "Article not found.");
  if (content.status === "ARCHIVED") throw new HttpError(409, "An archived article cannot be published.");
  const v = await getVersion(id, version);
  if (v.status !== "APPROVED") throw new HttpError(409, "Only an approved version can be published.");
  if (!v.reviewerId || v.reviewerId === v.authorId) throw new HttpError(403, "This version has no valid independent review.");
  if (contentHash(v) !== v.contentHash) throw new HttpError(409, "The article changed after it was reviewed. Submit it again.");
  const scan = scanEngagementContent({ texts: textsOf(v) });
  if (!scan.pass) throw Object.assign(new HttpError(422, "This article no longer passes the engagement content policy."), { findings: scan.findings });

  const payload = { contentId: id, version, contentHash: v.contentHash };
  const gate = await gateEngagementAction({ actionType: "ENGAGEMENT_CONTENT_PUBLISH", sourceId: `content:${id}:v${version}`, actor, reason, requestedPayload: payload });
  if (gate.requiresApproval && gate.status !== "READY_TO_EXECUTE") return { approvalRequired: true, approvalCode: gate.approvalCode, status: gate.status };
  if (gate.requiresApproval) await assertApprovedPayloadMatches(gate.approvalRequestId, payload);

  await prisma.$transaction([
    ...(content.publishedVersionId ? [prisma.engagementContentVersion.updateMany({ where: { id: content.publishedVersionId, status: "APPROVED" }, data: { status: "SUPERSEDED" } })] : []),
    prisma.engagementContent.update({ where: { id }, data: { status: "PUBLISHED", publishedVersionId: v.id } }),
  ]);
  if (gate.requiresApproval) await markApprovalExecuted(gate.approvalRequestId, actor.id);
  await engagementAudit({ action: "ENGAGEMENT_CONTENT_PUBLISHED", actorId: actor.id, resource: "engagement_content", resourceId: id, after: { version, contentHash: v.contentHash }, reason, approvalId: gate.requiresApproval ? gate.approvalCode : null });
  return { approvalRequired: false };
}

export async function unpublishContent(actor: SessionAdmin, id: string, reason: string) {
  if (reason.trim().length < 3) throw new HttpError(422, "A reason is required.");
  const c = await prisma.engagementContent.findUnique({ where: { id } });
  if (!c) throw new HttpError(404, "Article not found.");
  if (c.status !== "PUBLISHED") throw new HttpError(409, "Only a published article can be unpublished.");
  const updated = await prisma.engagementContent.update({ where: { id }, data: { status: "UNPUBLISHED" } });
  await engagementAudit({ action: "ENGAGEMENT_CONTENT_CHANGED", actorId: actor.id, resource: "engagement_content", resourceId: id, after: { status: "UNPUBLISHED" }, reason });
  return updated;
}

export async function archiveContent(actor: SessionAdmin, id: string, reason: string) {
  if (reason.trim().length < 5) throw new HttpError(422, "A reason is required.");
  const c = await prisma.engagementContent.findUnique({ where: { id } });
  if (!c) throw new HttpError(404, "Article not found.");
  const updated = await prisma.engagementContent.update({ where: { id }, data: { status: "ARCHIVED" } });
  await engagementAudit({ action: "ENGAGEMENT_CONTENT_CHANGED", actorId: actor.id, resource: "engagement_content", resourceId: id, after: { status: "ARCHIVED" }, reason });
  return updated;
}

export async function listContent(filter: { status?: string; take?: number } = {}) {
  return prisma.engagementContent.findMany({
    where: filter.status ? { status: filter.status as never } : {},
    orderBy: { updatedAt: "desc" }, take: Math.min(filter.take ?? 100, 200),
    include: { versions: { orderBy: { version: "desc" }, take: 1, select: { version: true, status: true, title: true, language: true } } },
  });
}

export async function getContentDetail(id: string) {
  const c = await prisma.engagementContent.findUnique({ where: { id }, include: { versions: { orderBy: { version: "desc" }, take: 30 } } });
  if (!c) throw new HttpError(404, "Article not found.");
  return c;
}

// ----- applicant side: only the PUBLISHED, in-window version is ever returned -----
export interface GuideArticle {
  slug: string;
  category: string;
  title: string;
  description: string | null;
  body?: string;
  language: string;
  authorName: string | null;
  imageUrl: string | null;
}

export async function listGuideArticles(opts: { language?: string; category?: string; q?: string } = {}, now: Date = new Date()): Promise<GuideArticle[]> {
  const rows = await prisma.engagementContent.findMany({
    where: {
      status: "PUBLISHED", publishedVersionId: { not: null }, ...(opts.category ? { category: opts.category } : {}),
      AND: [{ OR: [{ publishAt: null }, { publishAt: { lte: now } }] }, { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
    },
    orderBy: { updatedAt: "desc" }, take: 200,
  });
  if (!rows.length) return [];
  const versions = await prisma.engagementContentVersion.findMany({ where: { id: { in: rows.map((r) => r.publishedVersionId as string) } } });
  const byId = new Map(versions.map((v) => [v.id, v]));
  const q = opts.q?.trim().toLowerCase();
  const out: GuideArticle[] = [];
  for (const r of rows) {
    const v = byId.get(r.publishedVersionId as string);
    if (!v) continue;
    if (opts.language && v.language !== opts.language) continue;
    if (q && !(v.title.toLowerCase().includes(q) || (v.description ?? "").toLowerCase().includes(q))) continue;
    out.push({ slug: r.slug, category: r.category, title: v.title, description: v.description, language: v.language, authorName: v.authorName, imageUrl: v.imageUrl });
  }
  return out;
}

export async function getGuideArticle(slug: string, now: Date = new Date()): Promise<GuideArticle | null> {
  const r = await prisma.engagementContent.findUnique({ where: { slug } });
  if (!r || r.status !== "PUBLISHED" || !r.publishedVersionId) return null;
  if ((r.publishAt && r.publishAt > now) || (r.expiresAt && r.expiresAt <= now)) return null;
  const v = await prisma.engagementContentVersion.findUnique({ where: { id: r.publishedVersionId } });
  if (!v) return null;
  return { slug: r.slug, category: r.category, title: v.title, description: v.description, body: v.body, language: v.language, authorName: v.authorName, imageUrl: v.imageUrl };
}
