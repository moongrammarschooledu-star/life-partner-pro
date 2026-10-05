import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { MARKETING_FLAGS } from "@/lib/marketing/constants";
import { marketingBaseUrl } from "@/lib/marketing/hosts";

// Includes ONLY published landing pages that an editor explicitly marked for inclusion and indexing. Empty when
// marketing/public pages are off or no canonical base URL is configured.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = marketingBaseUrl();
  if (!base) return [];
  try {
    if (!(await isFeatureEnabled(MARKETING_FLAGS.master)) || !(await isFeatureEnabled(MARKETING_FLAGS.publicPages))) return [];
    const pages = await prisma.landingPage.findMany({ where: { status: "PUBLISHED", sitemapInclude: true, noindex: false, publishedVersionId: { not: null } }, select: { slug: true, updatedAt: true }, take: 1000 });
    return pages.map((p) => ({ url: `${base}/lp/${p.slug}`, lastModified: p.updatedAt }));
  } catch {
    return [];
  }
}
