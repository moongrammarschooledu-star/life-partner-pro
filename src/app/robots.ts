import type { MetadataRoute } from "next";
import { marketingBaseUrl } from "@/lib/marketing/hosts";
import { PRIVATE_PATH_PREFIXES } from "@/lib/public-site/routes";

// Private and signed-in areas are never crawlable (the list lives next to the route registry). Public utility pages (sign-in, report a
// concern, ...) and landing pages are NOT blocked here: a blocked path cannot be fetched, so its own noindex tag could never be read.
// Each of those decides its indexing through page metadata (noindex by default for utility pages and landing pages).
export default function robots(): MetadataRoute.Robots {
  const base = marketingBaseUrl();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: [...PRIVATE_PATH_PREFIXES] }],
    ...(base ? { sitemap: `${base}/sitemap.xml`, host: base } : {}),
  };
}
