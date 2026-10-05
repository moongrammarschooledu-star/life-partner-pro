import type { MetadataRoute } from "next";
import { marketingBaseUrl } from "@/lib/marketing/hosts";

// Private areas are never crawlable. Landing pages decide their own indexing through per-page robots metadata
// (noindex by default), so /lp/ is not blocked here — a blocked path could not be fetched to read its noindex tag.
export default function robots(): MetadataRoute.Robots {
  const base = marketingBaseUrl();
  return {
    rules: [{ userAgent: "*", disallow: ["/admin", "/api/", "/dashboard", "/family", "/my-", "/maintenance"] }],
    ...(base ? { sitemap: `${base}/sitemap.xml` } : {}),
  };
}
