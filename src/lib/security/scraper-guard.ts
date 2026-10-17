// Names that identify website copiers and bulk content crawlers. They are refused on public PAGES (never on /api, /admin or webhooks).
// This only stops the lazy copier: anyone can change a user-agent, so it is one layer next to the firewall, not the whole defence.
// Search engines (Googlebot, Bingbot) and link-preview fetchers (WhatsApp, Facebook, Telegram) are deliberately NOT listed.

/** Offline site copiers and scraping frameworks that announce themselves. */
export const SITE_COPIER_AGENTS = ["HTTrack", "WebCopier", "WebZIP", "Teleport", "SiteSucker", "Offline Explorer", "WebStripper", "Scrapy", "Wget", "Go-http-client", "python-requests", "aiohttp", "libwww-perl", "Apache-HttpClient", "okhttp-scrape"] as const;

/** Bulk SEO / AI-training crawlers that have no use for a private matrimonial site. */
export const BULK_CRAWLER_AGENTS = ["GPTBot", "ChatGPT-User", "CCBot", "ClaudeBot", "anthropic-ai", "Google-Extended", "PerplexityBot", "Bytespider", "Amazonbot", "AhrefsBot", "SemrushBot", "MJ12bot", "DotBot", "PetalBot", "DataForSeoBot", "Diffbot", "Omgilibot", "ImagesiftBot"] as const;

const BLOCKED = [...SITE_COPIER_AGENTS, ...BULK_CRAWLER_AGENTS].map((n) => n.toLowerCase());

/** True when the user-agent belongs to a known copier / bulk crawler. An empty or missing agent is not blocked here (health checks may omit it). */
export function isBlockedScraper(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return BLOCKED.some((name) => ua.includes(name));
}

/** Only public HTML pages are guarded. APIs, the admin area, webhooks, cron and machine-readable files keep working for their own callers. */
export function scraperGuardApplies(pathname: string, method: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  if (pathname.startsWith("/api/") || pathname.startsWith("/admin")) return false;
  if (pathname === "/robots.txt" || pathname === "/sitemap.xml" || pathname === "/sw.js" || pathname === "/manifest.webmanifest") return false;
  return true;
}
