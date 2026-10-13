import type { Metadata } from "next";
import { findPublicRoute, type PublicRoute } from "@/lib/public-site/routes";
import { SITE_NAME } from "@/lib/public-site/config";

// Page metadata comes from the route registry (title, description, indexing), so a page cannot drift from the sitemap. Relative
// `canonical` and `openGraph.url` values are resolved against `metadataBase` set in the root layout.
export function pageMetadata(path: string, override?: Partial<Pick<PublicRoute, "title" | "description">>): Metadata {
  const route = findPublicRoute(path);
  if (!route) throw new Error(`pageMetadata: "${path}" is not in PUBLIC_ROUTES`);
  const title = override?.title ?? route.title;
  const description = override?.description ?? route.description;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: path },
    robots: route.indexable ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: { type: "website", siteName: SITE_NAME, title, description, url: path, locale: "en" },
    twitter: { card: "summary", title, description },
  };
}

/** For pages built from content (articles, guides) that have their own title and description. */
export function contentMetadata(params: { path: string; title: string; description: string; indexable: boolean; type?: "website" | "article"; publishedTime?: string; modifiedTime?: string }): Metadata {
  return {
    title: { absolute: params.title },
    description: params.description,
    alternates: { canonical: params.path },
    robots: params.indexable ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: {
      type: params.type ?? "website",
      siteName: SITE_NAME,
      title: params.title,
      description: params.description,
      url: params.path,
      locale: "en",
      ...(params.type === "article" ? { publishedTime: params.publishedTime, modifiedTime: params.modifiedTime } : {}),
    },
    twitter: { card: "summary", title: params.title, description: params.description },
  };
}
