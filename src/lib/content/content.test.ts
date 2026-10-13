import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// ---- in-memory stand-in for the content tables (just enough behaviour for the rules under test) ----
type Row = Record<string, unknown> & { id: string; type: "ARTICLE" | "GUIDE"; slug: string; status: string; updatedById: string; version: number; scheduledFor: Date | null; publishedAt: Date | null; tags: string[]; title: string; summary: string; body: string };
const db = { posts: [] as Row[], authors: [{ id: "a1", active: true }, { id: "a-off", active: false }], categories: [{ id: "c-art", type: "ARTICLE" }, { id: "c-guide", type: "GUIDE" }], audit: [] as Array<Record<string, unknown>>, approval: false, seq: 0 };

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contentAuthor: { findUnique: async ({ where }: { where: { id: string } }) => db.authors.find((a) => a.id === where.id) ?? null },
    contentCategory: { findUnique: async ({ where }: { where: { id: string } }) => db.categories.find((c) => c.id === where.id) ?? null },
    contentPost: {
      findUnique: async ({ where }: { where: { id: string } }) => { const r = db.posts.find((p) => p.id === where.id); return r ? { ...r } : null; }, // a copy, like a database read
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (db.posts.some((p) => p.type === data.type && p.slug === data.slug)) throw Object.assign(new Error("dup"), { code: "P2002" });
        const row = { id: `p${++db.seq}`, status: "DRAFT", version: 1, scheduledFor: null, publishedAt: null, ...data } as Row;
        db.posts.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = db.posts.find((p) => p.id === where.id)!;
        for (const [k, v] of Object.entries(data)) {
          if (k === "version" && typeof v === "object") row.version += 1;
          else row[k] = v;
        }
        return row;
      },
      updateMany: async ({ where, data }: { where: { id: string; status: string }; data: Record<string, unknown> }) => {
        const row = db.posts.find((p) => p.id === where.id && p.status === where.status);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
      deleteMany: async ({ where }: { where: { id: string; status: string } }) => {
        const i = db.posts.findIndex((p) => p.id === where.id && p.status === where.status);
        if (i < 0) return { count: 0 };
        db.posts.splice(i, 1);
        return { count: 1 };
      },
    },
  },
}));
vi.mock("@/lib/audit", () => ({ writeAudit: async (row: Record<string, unknown>) => void db.audit.push(row) }));
vi.mock("@/lib/ops/feature-flags", () => ({ isFeatureEnabled: async () => db.approval }));

import { parseContent, parseInline, safeHref, plainText, readingMinutes } from "@/lib/content/markdown";
import { nextStatus, permissionForAction, selfPublishBlocked, isDeletable, isLive, type ContentAction } from "@/lib/content/status";
import { validateSlug, slugify } from "@/lib/content/slug";
import { scanPostContent } from "@/lib/content/policy";
import { createPost, updatePost, transitionPost, deletePost, normaliseTags, liveWhere } from "@/lib/content/service";
import { ContentBody } from "@/components/public/content-body";
import { ROLE_PERMISSIONS } from "@/lib/permissions";
import { FEATURE_FLAG_DEFAULTS } from "@/lib/ops/feature-flag-defs";

const BODY = "## How profiles are reviewed\n\nA person on our team reviews each profile before it is used for matching. This article explains the steps in plain language.\n\n- First, contact details are confirmed.\n- Then the profile is reviewed.";
const good = { type: "ARTICLE" as const, slug: "how-profiles-are-reviewed", title: "How profiles are reviewed", summary: "A short explanation of how a profile is reviewed by our team.", body: BODY, authorId: "a1", tags: ["Review", "profile "] };

beforeEach(() => {
  db.posts = [];
  db.audit = [];
  db.approval = false;
  db.seq = 0;
});

describe("Markdown subset", () => {
  it("parses headings, paragraphs, lists, quotes and inline formatting", () => {
    const blocks = parseContent("# Title\n\nSome **bold** and *italic* and `code`.\n\n1. one\n2. two\n\n> quoted\n\n### Sub");
    expect(blocks.map((b) => b.t)).toEqual(["h2", "p", "ol", "quote", "h3"]);
    const para = blocks[1] as { c: Array<{ t: string }> };
    expect(para.c.map((i) => i.t)).toEqual(["text", "strong", "text", "em", "text", "code", "text"]);
  });

  it("only relative and https links become links; every other kind of address is shown as plain text", () => {
    for (const ok of ["/pricing", "https://example.com/a?b=1"]) expect(safeHref(ok), ok).not.toBeNull();
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<b>", "http://example.com", "//evil.example", "mailto:a@b.c", "https://user:pw@example.com", "/a b", "https://", "vbscript:x", ""]) expect(safeHref(bad), bad).toBeNull();
    const inline = parseInline("[click](javascript:alert(1))");
    expect(inline.every((n) => n.t === "text")).toBe(true);
    expect(inline.map((n) => (n as { v: string }).v).join("")).toContain("click");
  });

  it("renders to HTML with no script, no event handler and no unsafe link, whatever the stored text contains", () => {
    const hostile = ["<script>alert(1)</script>", "<img src=x onerror=alert(1)>", "[a](javascript:alert(1))", '**<b onclick="x">bold</b>**', "[ok](/pricing) and [site](https://example.com)"].join("\n\n");
    const html = renderToStaticMarkup(createElement(ContentBody, { body: hostile }));
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<[^>]*\son(error|click)\s*=/i); // no tag carries an event handler (the words may appear as escaped text)
    expect(html).not.toMatch(/javascript:/i);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('href="/pricing"');
    expect(html).toMatch(/href="https:\/\/example\.com\/"[^>]*rel="noopener noreferrer nofollow"/);
  });

  it("estimates reading time and strips markup for plain text", () => {
    expect(plainText("## Hi **there** [link](/x)")).toBe("Hi there link");
    expect(readingMinutes("word ".repeat(450))).toBe(2);
    expect(readingMinutes("short")).toBe(1);
  });
});

describe("workflow rules", () => {
  it("allows exactly the documented transitions", () => {
    expect(nextStatus("SUBMIT", "DRAFT")).toBe("IN_REVIEW");
    expect(nextStatus("SUBMIT", "PUBLISHED")).toBeNull();
    expect(nextStatus("PUBLISH", "IN_REVIEW")).toBe("PUBLISHED");
    expect(nextStatus("PUBLISH", "ARCHIVED")).toBeNull();
    expect(nextStatus("SCHEDULE", "DRAFT")).toBe("SCHEDULED");
    expect(nextStatus("SCHEDULE", "PUBLISHED")).toBeNull();
    expect(nextStatus("ARCHIVE", "PUBLISHED")).toBe("ARCHIVED");
    expect(nextStatus("RESTORE", "ARCHIVED")).toBe("DRAFT");
    expect(nextStatus("RESTORE", "PUBLISHED")).toBeNull();
    expect(nextStatus("UNSCHEDULE", "SCHEDULED")).toBe("DRAFT");
    expect(nextStatus("REQUEST_CHANGES", "IN_REVIEW")).toBe("DRAFT");
  });

  it("maps each step to the permission it needs, so writing, publishing and archiving are separate grants", () => {
    const expected: Record<ContentAction, string> = { SUBMIT: "content:edit", REQUEST_CHANGES: "content:edit", UNSCHEDULE: "content:edit", PUBLISH: "content:publish", SCHEDULE: "content:publish", ARCHIVE: "content:archive", RESTORE: "content:archive" };
    for (const [a, p] of Object.entries(expected)) expect(permissionForAction(a as ContentAction), a).toBe(p);
  });

  it("when review is required the last editor may not publish or schedule, but others may", () => {
    expect(selfPublishBlocked({ approvalRequired: true, actorId: "u1", lastEditorId: "u1", action: "PUBLISH" })).toBe(true);
    expect(selfPublishBlocked({ approvalRequired: true, actorId: "u1", lastEditorId: "u1", action: "SCHEDULE" })).toBe(true);
    expect(selfPublishBlocked({ approvalRequired: true, actorId: "u2", lastEditorId: "u1", action: "PUBLISH" })).toBe(false);
    expect(selfPublishBlocked({ approvalRequired: false, actorId: "u1", lastEditorId: "u1", action: "PUBLISH" })).toBe(false);
    expect(selfPublishBlocked({ approvalRequired: true, actorId: "u1", lastEditorId: "u1", action: "ARCHIVE" })).toBe(false);
  });

  it("only drafts and archived items can be deleted; scheduled items go live only once due", () => {
    expect(["DRAFT", "ARCHIVED"].every((s) => isDeletable(s as never))).toBe(true);
    expect(["IN_REVIEW", "SCHEDULED", "PUBLISHED"].some((s) => isDeletable(s as never))).toBe(false);
    const now = new Date("2026-06-01T00:00:00Z");
    expect(isLive({ status: "PUBLISHED", scheduledFor: null }, now)).toBe(true);
    expect(isLive({ status: "SCHEDULED", scheduledFor: new Date("2026-05-01T00:00:00Z") }, now)).toBe(true);
    expect(isLive({ status: "SCHEDULED", scheduledFor: new Date("2026-07-01T00:00:00Z") }, now)).toBe(false);
    expect(isLive({ status: "DRAFT", scheduledFor: null }, now)).toBe(false);
    expect(isLive({ status: "ARCHIVED", scheduledFor: null }, now)).toBe(false);
  });

  it("the public query shows published items and scheduled items that are due, nothing else", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    expect(liveWhere(now)).toEqual({ OR: [{ status: "PUBLISHED" }, { status: "SCHEDULED", scheduledFor: { lte: now } }] });
  });
});

describe("slugs and tags", () => {
  it("accepts clean addresses and refuses unsafe or reserved ones", () => {
    expect(validateSlug("how-profiles-work")).toBeNull();
    for (const bad of ["ab", "UPPER", "a_b", "-a-b", "a--b", "a b", "new", "category", "x".repeat(81), "../etc"]) expect(validateSlug(bad), bad).not.toBeNull();
    expect(slugify("  How Profiles Work!  ")).toBe("how-profiles-work");
  });
  it("normalises tags: lowercase, hyphenated, de-duplicated, at most eight", () => {
    expect(normaliseTags(["Review", "review", "Family Meeting", "  ", "a/b"])).toEqual(["review", "family-meeting", "a-b"]);
    expect(normaliseTags(Array.from({ length: 20 }, (_, i) => `t${i}`))).toHaveLength(8);
  });
});

describe("creating and editing", () => {
  it("creates a draft, normalises tags, computes reading time and writes an audit row without the text", async () => {
    const post = await createPost("admin1", good);
    expect(post.status).toBe("DRAFT");
    expect(post.tags).toEqual(["review", "profile"]);
    expect(db.audit).toEqual([{ action: "CONTENT_CREATED", adminId: "admin1", meta: { postId: post.id, type: "ARTICLE", slug: "how-profiles-are-reviewed" } }]);
    expect(JSON.stringify(db.audit)).not.toContain("A person on our team");
  });

  it("refuses bad input: short title, short text, inactive author, a category of the wrong kind", async () => {
    await expect(createPost("a", { ...good, title: "Hi" })).rejects.toMatchObject({ status: 400 });
    await expect(createPost("a", { ...good, body: "too short" })).rejects.toMatchObject({ status: 400 });
    await expect(createPost("a", { ...good, authorId: "a-off" })).rejects.toMatchObject({ status: 400 });
    await expect(createPost("a", { ...good, categoryId: "c-guide" })).rejects.toMatchObject({ status: 400 });
    expect(db.posts).toHaveLength(0);
  });

  it("answers 409 for a repeated address", async () => {
    await createPost("a", good);
    await expect(createPost("a", good)).rejects.toMatchObject({ status: 409 });
  });

  it("updates a draft, bumps the version and records who last changed it", async () => {
    const p = await createPost("a", good);
    const up = await updatePost("b", p.id, { title: "A clearer title for this article" });
    expect(up.version).toBe(2);
    expect(db.posts[0].updatedById).toBe("b");
  });

  it("when review is required, a live item cannot be edited in place", async () => {
    const p = await createPost("a", good);
    await transitionPost("a", p.id, "PUBLISH");
    db.approval = true;
    await expect(updatePost("a", p.id, { title: "Changed after publishing the article" })).rejects.toMatchObject({ status: 409 });
  });
});

describe("publishing", () => {
  it("publishes a draft (review not required), sets the publish time and audits it", async () => {
    const p = await createPost("a", good);
    const r = await transitionPost("a", p.id, "PUBLISH");
    expect(r.status).toBe("PUBLISHED");
    expect(db.posts[0].publishedAt).toBeInstanceOf(Date);
    expect(db.posts[0].publishedById).toBe("a");
    expect(db.audit.at(-1)).toMatchObject({ action: "CONTENT_PUBLISHED", adminId: "a", meta: { from: "DRAFT", to: "PUBLISHED" } });
  });

  it("with review required, the person who last edited cannot publish, but another administrator can", async () => {
    db.approval = true;
    const p = await createPost("author", good);
    await expect(transitionPost("author", p.id, "PUBLISH")).rejects.toMatchObject({ status: 403 });
    await transitionPost("author", p.id, "SUBMIT");
    await expect(transitionPost("author", p.id, "PUBLISH")).rejects.toMatchObject({ status: 403 });
    await expect(transitionPost("reviewer", p.id, "PUBLISH")).resolves.toMatchObject({ status: "PUBLISHED" });
  });

  it("refuses to publish text the content policy blocks (guarantees, 100%, links to other sites)", async () => {
    for (const body of [`${BODY}\n\nWe guarantee a perfect match for every applicant who joins.`, `${BODY}\n\nOur service has a 100% success rate for families.`, `${BODY}\n\nVisit [our partner](https://other-site.example) today.`]) {
      db.posts = [];
      const p = await createPost("a", { ...good, slug: `post-${db.seq + 1}`, body });
      await expect(transitionPost("a", p.id, "PUBLISH"), body.slice(-40)).rejects.toMatchObject({ status: 422 });
      expect(db.posts[0].status).toBe("DRAFT");
    }
  });

  it("lets a disclaimer that denies a guarantee through, and the clean sample passes the policy", () => {
    expect(scanPostContent({ ...good, body: `${BODY}\n\nWe do not guarantee any outcome.` }).pass).toBe(true);
    expect(scanPostContent(good).pass).toBe(true);
  });

  it("scheduling needs a future date, and the item is not live before it", async () => {
    const p = await createPost("a", good);
    await expect(transitionPost("a", p.id, "SCHEDULE")).rejects.toMatchObject({ status: 400 });
    await expect(transitionPost("a", p.id, "SCHEDULE", { scheduledFor: new Date(Date.now() - 1000) })).rejects.toMatchObject({ status: 400 });
    const when = new Date(Date.now() + 3_600_000);
    await transitionPost("a", p.id, "SCHEDULE", { scheduledFor: when });
    expect(db.posts[0]).toMatchObject({ status: "SCHEDULED", scheduledFor: when, publishedAt: null });
    expect(isLive(db.posts[0] as never, new Date())).toBe(false);
    expect(isLive(db.posts[0] as never, new Date(when.getTime() + 1))).toBe(true);
  });

  it("refuses a step that does not fit the current state, and two people acting at once settle once", async () => {
    const p = await createPost("a", good);
    await expect(transitionPost("a", p.id, "RESTORE")).rejects.toMatchObject({ status: 409 });
    const results = await Promise.allSettled([transitionPost("a", p.id, "PUBLISH"), transitionPost("b", p.id, "ARCHIVE")]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    expect(["PUBLISHED", "ARCHIVED"]).toContain(db.posts[0].status);
  });

  it("archiving takes an item off the public list; restoring returns it to a draft; only drafts and archived items can be deleted", async () => {
    const p = await createPost("a", good);
    await transitionPost("a", p.id, "PUBLISH");
    await expect(deletePost("a", p.id)).rejects.toMatchObject({ status: 409 });
    await transitionPost("a", p.id, "ARCHIVE");
    expect(isLive(db.posts[0] as never, new Date())).toBe(false);
    await transitionPost("a", p.id, "RESTORE");
    expect(db.posts[0].status).toBe("DRAFT");
    await deletePost("a", p.id);
    expect(db.posts).toHaveLength(0);
    expect(db.audit.at(-1)).toMatchObject({ action: "CONTENT_DELETED" });
  });
});

describe("API routes and permissions", () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

  it("every content route checks the right permission before doing anything", () => {
    expect(read("src/app/api/admin/content/route.ts")).toMatch(/requireAdmin\("content:view"\)[\s\S]*requireAdmin\("content:create"\)/);
    const item = read("src/app/api/admin/content/[id]/route.ts");
    expect(item).toContain('requireAdmin("content:view")');
    expect(item).toContain('requireAdmin("content:edit")');
    expect(item).toContain('requireAdmin("content:delete")');
    expect(read("src/app/api/admin/content/authors/route.ts")).toContain('requireAdmin("content:create")');
    expect(read("src/app/api/admin/content/categories/route.ts")).toContain('requireAdmin("content:create")');
    const t = read("src/app/api/admin/content/[id]/transition/route.ts");
    expect(t.indexOf("await requireAdmin();")).toBeGreaterThan(-1);
    expect(t.indexOf("await requireAdmin();")).toBeLessThan(t.indexOf("req.json()"));
    expect(t).toContain("requireAdmin(permissionForAction(");
  });

  it("the pages require content:view and the navigation entry is gated by it", () => {
    expect(read("src/app/admin/(shell)/content/page.tsx")).toContain('requirePagePermission("content:view")');
    expect(read("src/app/admin/(shell)/content/[id]/page.tsx")).toContain('requirePagePermission("content:view")');
    expect(read("src/components/admin/admin-shell.tsx")).toMatch(/\/admin\/content[^}]*permission: "content:view"/);
  });

  it("Super Admin holds every content permission; the communication manager can draft and edit but not publish, archive or delete; no staff role has any", () => {
    const all = ["content:view", "content:create", "content:edit", "content:publish", "content:archive", "content:delete"] as const;
    for (const p of all) expect(ROLE_PERMISSIONS.SUPER_ADMIN, p).toContain(p);
    expect(ROLE_PERMISSIONS.COMMUNICATION_MANAGER).toEqual(expect.arrayContaining(["content:view", "content:create", "content:edit"]));
    for (const p of ["content:publish", "content:archive", "content:delete"] as const) expect(ROLE_PERMISSIONS.COMMUNICATION_MANAGER, p).not.toContain(p);
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
      if (role === "SUPER_ADMIN" || role === "COMMUNICATION_MANAGER") continue;
      expect(perms.some((p) => p.startsWith("content:")), role).toBe(false);
    }
  });

  it("the review-required switch exists and defaults to off", () => {
    expect(FEATURE_FLAG_DEFAULTS["content.approval_required"]).toBe(false);
  });

  it("public content pages never inject raw HTML", () => {
    for (const f of ["src/components/public/content-body.tsx", "src/components/public/content-pages.tsx"]) expect(read(f), f).not.toContain("dangerouslySetInnerHTML");
  });
});
