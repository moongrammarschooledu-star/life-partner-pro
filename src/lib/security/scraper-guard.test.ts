import { describe, expect, it } from "vitest";
import { BULK_CRAWLER_AGENTS, isBlockedScraper, scraperGuardApplies } from "./scraper-guard";

describe("scraper guard", () => {
  it("blocks website copiers and bulk crawlers, ignoring case", () => {
    expect(isBlockedScraper("Mozilla/4.5 (compatible; HTTrack 3.0x; Windows 98)")).toBe(true);
    expect(isBlockedScraper("Wget/1.21.4")).toBe(true);
    expect(isBlockedScraper("Mozilla/5.0 AppleWebKit/537.36 (compatible; GPTBot/1.1)")).toBe(true);
    expect(isBlockedScraper("scrapy/2.11")).toBe(true);
    for (const name of BULK_CRAWLER_AGENTS) expect(isBlockedScraper(`x ${name}/1.0`)).toBe(true);
  });

  it("lets people, search engines and link previews through", () => {
    expect(isBlockedScraper("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1")).toBe(false);
    expect(isBlockedScraper("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe(false);
    expect(isBlockedScraper("Mozilla/5.0 (compatible; bingbot/2.0)")).toBe(false);
    expect(isBlockedScraper("WhatsApp/2.23.20.0 A")).toBe(false);
    expect(isBlockedScraper("facebookexternalhit/1.1")).toBe(false);
    expect(isBlockedScraper("curl/8.4.0")).toBe(false);
    expect(isBlockedScraper("")).toBe(false);
    expect(isBlockedScraper(null)).toBe(false);
  });

  it("guards public pages only", () => {
    expect(scraperGuardApplies("/", "GET")).toBe(true);
    expect(scraperGuardApplies("/blog/some-post", "GET")).toBe(true);
    expect(scraperGuardApplies("/api/register", "GET")).toBe(false);
    expect(scraperGuardApplies("/api/webhooks/whatsapp", "GET")).toBe(false);
    expect(scraperGuardApplies("/admin/login", "GET")).toBe(false);
    expect(scraperGuardApplies("/robots.txt", "GET")).toBe(false);
    expect(scraperGuardApplies("/register", "POST")).toBe(false);
  });
});
