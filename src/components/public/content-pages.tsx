import Link from "next/link";
import type { ContentType } from "@prisma/client";
import { Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
import { JsonLd } from "@/components/public/json-ld";
import { PageShell, PageHeading, Notice, CtaBand } from "@/components/public/page-kit";
import { ContentBody } from "@/components/public/content-body";
import { listLiveCategories, listLivePosts, listLiveTags, getLivePost } from "@/lib/content/service";
import { publicPath } from "@/lib/content/paths";
import { articleLd } from "@/lib/public-site/structured-data";
import { cn } from "@/lib/utils";

const SECTION = { ARTICLE: { path: "/blog", name: "Blog", lead: "Informational articles on matrimonial matchmaking, family participation and safe online practices." }, GUIDE: { path: "/guides", name: "Guides", lead: "Step-by-step guides to help you prepare." } } as const;

function formatDate(d: Date | null): string {
  return d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "";
}

export type IndexSearch = { category?: string | string[]; tag?: string | string[]; page?: string | string[] };
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** A filtered or paged list is a different view of the same content: kept out of search results so only the canonical list and the items are indexed. */
export function isFilteredView(search: IndexSearch): boolean {
  return Boolean(first(search.category) || first(search.tag) || (first(search.page) && first(search.page) !== "1"));
}

export async function ContentIndexPage({ type, search }: { type: ContentType; search: IndexSearch }) {
  const s = SECTION[type];
  const category = first(search.category);
  const tag = first(search.tag);
  const page = Number(first(search.page)) || 1;
  const [list, categories, tags] = await Promise.all([listLivePosts({ type, categorySlug: category, tag, page }), listLiveCategories(type), listLiveTags(type)]);

  const href = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const merged = { category, tag, page: undefined as string | undefined, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    const qs = q.toString();
    return qs ? `${s.path}?${qs}` : s.path;
  };
  const chip = (active: boolean) => cn("rounded-full border px-3 py-1 text-sm", active ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted hover:text-foreground");

  return (
    <PageShell path={s.path} title={s.name} description={s.lead} width="max-w-5xl">
      <PageHeading title={s.name} lead={s.lead} />

      {(categories.length > 0 || tags.length > 0) && (
        <div className="mb-8 space-y-3">
          {categories.length > 0 && (
            <nav aria-label="Categories" className="flex flex-wrap gap-2">
              <Link href={s.path} className={chip(!category)}>All</Link>
              {categories.map((c) => (
                <Link key={c.slug} href={href({ category: c.slug, tag: undefined })} className={chip(category === c.slug)}>{c.name}</Link>
              ))}
            </nav>
          )}
          {tags.length > 0 && (
            <nav aria-label="Tags" className="flex flex-wrap gap-2 text-xs">
              {tags.map((t) => (
                <Link key={t} href={href({ tag: t, category: undefined })} className={chip(tag === t)}>#{t}</Link>
              ))}
            </nav>
          )}
        </div>
      )}

      {list.items.length === 0 ? (
        <Notice title={category || tag ? "Nothing matches that filter" : `No ${s.name.toLowerCase()} published yet`}>
          {category || tag ? <Link href={s.path} className="underline">Show everything</Link> : "Please check back soon."}
        </Notice>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.items.map((p) => (
            <li key={p.slug}>
              <Card className="h-full">
                <CardContent className="flex h-full flex-col gap-2">
                  {p.category && <span className="text-xs font-medium text-primary">{p.category.name}</span>}
                  <h2 className="font-heading text-lg font-semibold">
                    <Link href={publicPath(type, p.slug)} className="hover:underline">{p.title}</Link>
                  </h2>
                  <p className="flex-1 text-sm text-muted">{p.summary}</p>
                  <p className="flex items-center gap-1 text-xs text-muted">
                    <Clock className="h-3 w-3" aria-hidden="true" /> {p.readingMinutes} min read · {formatDate(p.publishedAt ?? p.scheduledFor)}
                  </p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {list.pages > 1 && (
        <nav aria-label="Pages" className="mt-8 flex items-center justify-between text-sm">
          {list.page > 1 ? <Link href={href({ page: String(list.page - 1) })} className={buttonClass({ variant: "outline", size: "sm" })}>Newer</Link> : <span />}
          <span className="text-muted">Page {list.page} of {list.pages}</span>
          {list.page < list.pages ? <Link href={href({ page: String(list.page + 1) })} className={buttonClass({ variant: "outline", size: "sm" })}>Older</Link> : <span />}
        </nav>
      )}
    </PageShell>
  );
}

export async function ContentArticlePage({ type, slug }: { type: ContentType; slug: string }) {
  const post = await getLivePost(type, slug);
  if (!post) return null;
  const s = SECTION[type];
  const path = publicPath(type, post.slug);
  const published = post.publishedAt ?? post.scheduledFor ?? post.createdAt;
  return (
    <PageShell path={path} title={post.title} description={post.summary} crumbs={[{ name: s.name, path: s.path }]} width="max-w-3xl">
      <JsonLd data={articleLd({ path, headline: post.title, description: post.summary, datePublished: published.toISOString(), dateModified: post.updatedAt.toISOString(), authorName: post.author.name })} />
      <article>
        <header className="mb-8">
          {post.category && <p className="text-sm font-medium text-primary">{post.category.name}</p>}
          <h1 className="mt-1 font-heading text-3xl font-semibold tracking-tight sm:text-4xl">{post.title}</h1>
          <p className="mt-3 text-lg text-muted">{post.summary}</p>
          <p className="mt-3 text-sm text-muted">
            By {post.author.name} · <time dateTime={published.toISOString()}>{formatDate(published)}</time> · {post.readingMinutes} min read
          </p>
        </header>
        <ContentBody body={post.body} />
        {post.tags.length > 0 && (
          <p className="mt-8 flex flex-wrap gap-2 text-xs">
            {post.tags.map((t) => (
              <Link key={t} href={`${s.path}?tag=${encodeURIComponent(t)}`} className="rounded-full border border-border px-3 py-1 text-muted hover:text-foreground">#{t}</Link>
            ))}
          </p>
        )}
      </article>
      <div className="mt-10">
        <Notice title="For information only">This article is general information. It is not legal, medical or professional advice, and it does not promise any outcome from using Life Partner Pro.</Notice>
      </div>
      <CtaBand title="Ready to begin?" primary={{ href: "/register", label: "Create Your Profile" }} secondary={{ href: s.path, label: `More ${s.name.toLowerCase()}` }} />
    </PageShell>
  );
}
