import type { ContentStatus, ContentType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { writeAudit } from "@/lib/audit";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { readingMinutes } from "@/lib/content/markdown";
import { validateSlug } from "@/lib/content/slug";
import { scanPostContent } from "@/lib/content/policy";
import { isDeletable, nextStatus, selfPublishBlocked, type ContentAction } from "@/lib/content/status";

export const APPROVAL_FLAG = "content.approval_required";
export const PAGE_SIZE = 9;

export interface PostInput {
  type: ContentType;
  slug: string;
  title: string;
  summary: string;
  body: string;
  authorId: string;
  categoryId?: string | null;
  tags?: string[];
  seoTitle?: string | null;
  seoDescription?: string | null;
  noindex?: boolean;
}

export function normaliseTags(tags: string[] | undefined): string[] {
  const seen = new Set<string>();
  for (const t of tags ?? []) {
    const tag = t.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
    if (tag) seen.add(tag);
  }
  return [...seen].slice(0, 8);
}

function validateInput(input: Partial<PostInput>, requireAll: boolean) {
  const bad = (m: string) => new HttpError(400, m);
  if (requireAll || input.slug !== undefined) {
    const msg = validateSlug(input.slug ?? "");
    if (msg) throw bad(msg);
  }
  if (requireAll || input.title !== undefined) {
    const t = (input.title ?? "").trim();
    if (t.length < 5 || t.length > 150) throw bad("The title must be 5 to 150 characters.");
  }
  if (requireAll || input.summary !== undefined) {
    const s = (input.summary ?? "").trim();
    if (s.length < 20 || s.length > 300) throw bad("The summary must be 20 to 300 characters.");
  }
  if (requireAll || input.body !== undefined) {
    const b = (input.body ?? "").trim();
    if (b.length < 50 || b.length > 50_000) throw bad("The text must be 50 to 50,000 characters.");
  }
  if (input.seoTitle && input.seoTitle.length > 70) throw bad("The search title can be at most 70 characters.");
  if (input.seoDescription && input.seoDescription.length > 170) throw bad("The search description can be at most 170 characters.");
}

async function assertAuthorAndCategory(type: ContentType, authorId: string | undefined, categoryId: string | null | undefined) {
  if (authorId) {
    const a = await prisma.contentAuthor.findUnique({ where: { id: authorId }, select: { active: true } });
    if (!a || !a.active) throw new HttpError(400, "Choose an active author.");
  }
  if (categoryId) {
    const c = await prisma.contentCategory.findUnique({ where: { id: categoryId }, select: { type: true } });
    if (!c || c.type !== type) throw new HttpError(400, "Choose a category for this kind of content.");
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

export async function createPost(actorId: string, input: PostInput) {
  validateInput(input, true);
  await assertAuthorAndCategory(input.type, input.authorId, input.categoryId);
  try {
    const post = await prisma.contentPost.create({
      data: {
        type: input.type,
        slug: input.slug,
        title: input.title.trim(),
        summary: input.summary.trim(),
        body: input.body.trim(),
        authorId: input.authorId,
        categoryId: input.categoryId ?? null,
        tags: normaliseTags(input.tags),
        seoTitle: input.seoTitle?.trim() || null,
        seoDescription: input.seoDescription?.trim() || null,
        noindex: input.noindex ?? false,
        readingMinutes: readingMinutes(input.body),
        createdById: actorId,
        updatedById: actorId,
      },
    });
    await writeAudit({ action: "CONTENT_CREATED", adminId: actorId, meta: { postId: post.id, type: post.type, slug: post.slug } });
    return post;
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, "Another item already uses that address.");
    throw err;
  }
}

export async function updatePost(actorId: string, id: string, patch: Partial<PostInput>) {
  const existing = await prisma.contentPost.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, "Not found.");
  validateInput(patch, false);
  await assertAuthorAndCategory(existing.type, patch.authorId, patch.categoryId);
  if ((existing.status === "PUBLISHED" || existing.status === "SCHEDULED") && (await isFeatureEnabled(APPROVAL_FLAG))) {
    throw new HttpError(409, "This item is live and review is required. Archive it and restore it to a draft before changing it.");
  }
  const data: Prisma.ContentPostUncheckedUpdateInput = { updatedById: actorId, version: { increment: 1 } };
  if (patch.slug !== undefined) data.slug = patch.slug;
  if (patch.title !== undefined) data.title = patch.title.trim();
  if (patch.summary !== undefined) data.summary = patch.summary.trim();
  if (patch.body !== undefined) {
    data.body = patch.body.trim();
    data.readingMinutes = readingMinutes(patch.body);
  }
  if (patch.authorId !== undefined) data.authorId = patch.authorId;
  if (patch.categoryId !== undefined) data.categoryId = patch.categoryId;
  if (patch.tags !== undefined) data.tags = normaliseTags(patch.tags);
  if (patch.seoTitle !== undefined) data.seoTitle = patch.seoTitle?.trim() || null;
  if (patch.seoDescription !== undefined) data.seoDescription = patch.seoDescription?.trim() || null;
  if (patch.noindex !== undefined) data.noindex = patch.noindex;
  try {
    const post = await prisma.contentPost.update({ where: { id }, data });
    await writeAudit({ action: "CONTENT_UPDATED", adminId: actorId, meta: { postId: id, version: post.version } });
    return post;
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, "Another item already uses that address.");
    throw err;
  }
}

const AUDIT_FOR_ACTION: Record<ContentAction, "CONTENT_SUBMITTED" | "CONTENT_PUBLISHED" | "CONTENT_ARCHIVED" | "CONTENT_UPDATED"> = {
  SUBMIT: "CONTENT_SUBMITTED",
  REQUEST_CHANGES: "CONTENT_UPDATED",
  PUBLISH: "CONTENT_PUBLISHED",
  SCHEDULE: "CONTENT_PUBLISHED",
  UNSCHEDULE: "CONTENT_UPDATED",
  ARCHIVE: "CONTENT_ARCHIVED",
  RESTORE: "CONTENT_UPDATED",
};

export async function transitionPost(actorId: string, id: string, action: ContentAction, opts: { scheduledFor?: Date | null } = {}) {
  const post = await prisma.contentPost.findUnique({ where: { id } });
  if (!post) throw new HttpError(404, "Not found.");
  const to = nextStatus(action, post.status);
  if (!to) throw new HttpError(409, `This item cannot do that from its current state (${post.status.toLowerCase().replace("_", " ")}).`);

  if (selfPublishBlocked({ approvalRequired: await isFeatureEnabled(APPROVAL_FLAG), actorId, lastEditorId: post.updatedById, action })) {
    throw new HttpError(403, "Review is required: someone other than the last editor must publish this.");
  }

  const data: Prisma.ContentPostUncheckedUpdateManyInput = { status: to, updatedById: actorId };
  let warnings = 0;
  if (action === "PUBLISH" || action === "SCHEDULE") {
    const scan = scanPostContent(post);
    if (!scan.pass) throw new HttpError(422, `The content policy check found ${scan.blocked} problem(s): ${scan.findings.filter((f) => f.severity === "BLOCK").map((f) => `${f.field ?? "text"} — ${f.rule.toLowerCase().replace(/_/g, " ")}`).join("; ")}.`);
    warnings = scan.warnings;
    if (action === "SCHEDULE") {
      const when = opts.scheduledFor;
      if (!when || Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) throw new HttpError(400, "Choose a date and time in the future.");
      data.scheduledFor = when;
      data.publishedAt = null;
    } else {
      data.publishedAt = post.publishedAt ?? new Date();
      data.scheduledFor = null;
    }
    data.publishedById = actorId;
    data.archivedAt = null;
  } else if (action === "ARCHIVE") {
    data.archivedAt = new Date();
  } else if (action === "RESTORE" || action === "UNSCHEDULE" || action === "REQUEST_CHANGES") {
    data.archivedAt = null;
    data.scheduledFor = null;
  }

  // Compare-and-set on the status we read, so two people acting at once cannot both succeed.
  const claimed = await prisma.contentPost.updateMany({ where: { id, status: post.status }, data });
  if (claimed.count !== 1) throw new HttpError(409, "Someone else changed this item. Reload and try again.");
  await writeAudit({ action: AUDIT_FOR_ACTION[action], adminId: actorId, meta: { postId: id, action, from: post.status, to } });
  return { status: to as ContentStatus, warnings };
}

export async function deletePost(actorId: string, id: string) {
  const post = await prisma.contentPost.findUnique({ where: { id }, select: { id: true, status: true, type: true, slug: true } });
  if (!post) throw new HttpError(404, "Not found.");
  if (!isDeletable(post.status)) throw new HttpError(409, "Only a draft or an archived item can be deleted.");
  const gone = await prisma.contentPost.deleteMany({ where: { id, status: post.status } });
  if (gone.count !== 1) throw new HttpError(409, "Someone else changed this item. Reload and try again.");
  await writeAudit({ action: "CONTENT_DELETED", adminId: actorId, meta: { postId: id, type: post.type, slug: post.slug } });
}

export async function createAuthor(actorId: string, input: { name: string; bio?: string | null }) {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) throw new HttpError(400, "The name must be 2 to 80 characters.");
  const author = await prisma.contentAuthor.create({ data: { name, bio: input.bio?.trim().slice(0, 400) || null } });
  await writeAudit({ action: "CONTENT_CREATED", adminId: actorId, meta: { authorId: author.id } });
  return author;
}

export async function createCategory(actorId: string, input: { type: ContentType; slug: string; name: string; description?: string | null }) {
  const msg = validateSlug(input.slug);
  if (msg) throw new HttpError(400, msg);
  const name = input.name.trim();
  if (name.length < 2 || name.length > 60) throw new HttpError(400, "The name must be 2 to 60 characters.");
  try {
    const category = await prisma.contentCategory.create({ data: { type: input.type, slug: input.slug, name, description: input.description?.trim().slice(0, 200) || null } });
    await writeAudit({ action: "CONTENT_CREATED", adminId: actorId, meta: { categoryId: category.id } });
    return category;
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, "That category address already exists.");
    throw err;
  }
}

// ---------------------------------------------------------------- public reads

/** Published, or scheduled and already due. */
export function liveWhere(now: Date = new Date()): Prisma.ContentPostWhereInput {
  return { OR: [{ status: "PUBLISHED" }, { status: "SCHEDULED", scheduledFor: { lte: now } }] };
}

export async function listLivePosts(params: { type: ContentType; categorySlug?: string; tag?: string; page?: number }) {
  const where: Prisma.ContentPostWhereInput = { AND: [{ type: params.type }, liveWhere(), ...(params.categorySlug ? [{ category: { slug: params.categorySlug } }] : []), ...(params.tag ? [{ tags: { has: params.tag } }] : [])] };
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const [items, total] = await Promise.all([
    prisma.contentPost.findMany({
      where,
      orderBy: [{ publishedAt: "desc" }, { scheduledFor: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { slug: true, title: true, summary: true, publishedAt: true, scheduledFor: true, readingMinutes: true, tags: true, category: { select: { slug: true, name: true } }, author: { select: { name: true } } },
    }),
    prisma.contentPost.count({ where }),
  ]);
  return { items, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function getLivePost(type: ContentType, slug: string) {
  return prisma.contentPost.findFirst({
    where: { AND: [{ type, slug }, liveWhere()] },
    include: { category: { select: { slug: true, name: true } }, author: { select: { name: true, bio: true } } },
  });
}

export async function listLiveCategories(type: ContentType) {
  const cats = await prisma.contentCategory.findMany({ where: { type }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { slug: true, name: true, _count: { select: { posts: { where: liveWhere() } } } } });
  return cats.filter((c) => c._count.posts > 0).map((c) => ({ slug: c.slug, name: c.name, count: c._count.posts }));
}

export async function listLiveTags(type: ContentType): Promise<string[]> {
  const rows = await prisma.contentPost.findMany({ where: { AND: [{ type }, liveWhere()] }, select: { tags: true }, take: 500 });
  return [...new Set(rows.flatMap((r) => r.tags))].sort();
}

export async function listLiveForSitemap() {
  return prisma.contentPost.findMany({ where: { AND: [liveWhere(), { noindex: false }] }, select: { type: true, slug: true, updatedAt: true }, take: 5000 });
}

export async function listLiveForSitemapSafe() {
  try {
    return await listLiveForSitemap();
  } catch {
    return [];
  }
}

export { publicPath } from "@/lib/content/paths";
