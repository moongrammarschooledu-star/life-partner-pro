import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { MARKETING_FLAGS } from "@/lib/marketing/constants";
import { marketingBaseUrl } from "@/lib/marketing/hosts";
import { PUBLIC_ROUTES } from "@/lib/public-site/routes";
import { listLiveForSitemapSafe, publicPath } from "@/lib/content/service";

// Public pages only. Lists: (1) every indexable page in the route registry, (2) published landing pages that an editor explicitly marked for
// inclusion and indexing. Never lists a profile, dashboard, family, proposal, admin, API or search URL: none of those are in the registry.
// No `lastModified` is invented for fixed pages. Empty only when no canonical base URL is configured.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = marketingBaseUrl();
  if (!base) return [];

  const fixed: MetadataRoute.Sitemap = PUBLIC_ROUTES.filter((r) => r.indexable).map((r) => ({
    url: `${base}${r.path === "/" ? "" : r.path}`,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));

  // Published (or scheduled and due) blog articles and guides that are not marked noindex.
  const posts = (await listLiveForSitemapSafe()).map((p) => ({ url: `${base}${publicPath(p.type, p.slug)}`, lastModified: p.updatedAt }));
  const withPosts = [...fixed, ...posts];

  try {
    if (!(await isFeatureEnabled(MARKETING_FLAGS.master)) || !(await isFeatureEnabled(MARKETING_FLAGS.publicPages))) return withPosts;
    const pages = await prisma.landingPage.findMany({ where: { status: "PUBLISHED", sitemapInclude: true, noindex: false, publishedVersionId: { not: null } }, select: { slug: true, updatedAt: true }, take: 1000 });
    return [...withPosts, ...pages.map((p) => ({ url: `${base}/lp/${p.slug}`, lastModified: p.updatedAt }))];
  } catch {
    return withPosts;
  }
}
