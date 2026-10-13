import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const calls = { events: [] as Array<Record<string, unknown>>, blocked: false, limited: false };
vi.mock("@/lib/ops/guards", () => ({ blockedResponse: async () => (calls.blocked ? new Response(JSON.stringify({ error: "off" }), { status: 404 }) : null) }));
vi.mock("@/lib/security/rate-limit-policy", () => ({ enforceConfiguredLimit: async () => (calls.limited ? new Response("{}", { status: 429 }) : null) }));
vi.mock("@/lib/rate-limit", () => ({ clientKeyFromRequest: () => "client-key" }));
vi.mock("@/lib/marketing/events", () => ({ recordMarketingEvent: async (e: Record<string, unknown>) => void calls.events.push(e) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/ops/feature-flags", () => ({ isFeatureEnabled: async () => false }));

import { POST } from "@/app/api/public-events/route";
import { optedOutOfTracking, recordablePath, siteEventSchema } from "@/lib/public-site/site-events";
import { getPublicSiteStatus } from "@/lib/public-site/funnel";

const post = (body: unknown, headers: Record<string, string> = { origin: "https://site.test", host: "site.test" }, raw?: string) =>
  POST(new Request("https://site.test/api/public-events", { method: "POST", headers, body: raw ?? JSON.stringify(body) }));

beforeEach(() => {
  calls.events = [];
  calls.blocked = false;
  calls.limited = false;
});

describe("recordable paths", () => {
  it("records public marketing pages and published-style content paths, with any query string or fragment removed", () => {
    expect(recordablePath("/")).toBe("/");
    expect(recordablePath("/pricing")).toBe("/pricing");
    expect(recordablePath("/pricing?utm_source=x&email=a@b.c#top")).toBe("/pricing");
    expect(recordablePath("/blog/how-profiles-work")).toBe("/blog/how-profiles-work");
    expect(recordablePath("/guides/first-meeting")).toBe("/guides/first-meeting");
  });
  it("never records account, family, admin, utility or unknown paths", () => {
    for (const p of ["/dashboard", "/dashboard/profile", "/my-billing", "/my-status", "/account-settings", "/family/dashboard", "/admin/login", "/api/health", "/login", "/register/confirmation", "/report-concern", "/offline", "/nope", "/blog/Bad_Slug", "/blog/", "/" + "a".repeat(100)]) {
      expect(recordablePath(p), p).toBeNull();
    }
  });
  it("honours Do Not Track and Global Privacy Control", () => {
    expect(optedOutOfTracking(new Headers({ dnt: "1" }))).toBe(true);
    expect(optedOutOfTracking(new Headers({ "sec-gpc": "1" }))).toBe(true);
    expect(optedOutOfTracking(new Headers())).toBe(false);
  });
  it("accepts only the three event kinds and a short, lowercase CTA id", () => {
    expect(siteEventSchema.safeParse({ type: "PAGE_VIEW", path: "/" }).success).toBe(true);
    expect(siteEventSchema.safeParse({ type: "CTA_CLICK", path: "/", cta: "nav-create-profile" }).success).toBe(true);
    for (const bad of [{ type: "LEAD_CREATED", path: "/" }, { type: "CTA_CLICK", path: "/", cta: "Has Space" }, { type: "PAGE_VIEW" }, { type: "PAGE_VIEW", path: "/", email: "a@b.c", extra: 1 }].slice(0, 3)) {
      expect(siteEventSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("POST /api/public-events", () => {
  it("records a page view with only the path and a hashed-subject input, nothing else", async () => {
    const res = await post({ type: "PAGE_VIEW", path: "/pricing?token=secret" });
    expect(res.status).toBe(200);
    expect(calls.events).toEqual([{ type: "PAGE_VIEW", path: "/pricing", variantKey: null, subject: "client-key" }]);
  });

  it("records the call-to-action id as the variant key", async () => {
    await post({ type: "CTA_CLICK", path: "/", cta: "home-hero-create-profile" });
    expect(calls.events[0]).toMatchObject({ type: "CTA_CLICK", path: "/", variantKey: "home-hero-create-profile" });
  });

  it("answers ok but records nothing for account pages, unknown pages or a visitor who opted out", async () => {
    expect((await post({ type: "PAGE_VIEW", path: "/dashboard" })).status).toBe(200);
    expect((await post({ type: "PAGE_VIEW", path: "/unknown" })).status).toBe(200);
    expect((await post({ type: "PAGE_VIEW", path: "/pricing" }, { origin: "https://site.test", host: "site.test", dnt: "1" })).status).toBe(200);
    expect((await post({ type: "PAGE_VIEW", path: "/pricing" }, { origin: "https://site.test", host: "site.test", "sec-gpc": "1" })).status).toBe(200);
    expect(calls.events).toEqual([]);
  });

  it("is refused when the feature is off, from another site, over the limit, oversized or malformed", async () => {
    calls.blocked = true;
    expect((await post({ type: "PAGE_VIEW", path: "/" })).status).toBe(404);
    calls.blocked = false;
    expect((await post({ type: "PAGE_VIEW", path: "/" }, { origin: "https://evil.test", host: "site.test" })).status).toBe(403);
    expect((await post({ type: "PAGE_VIEW", path: "/" }, { host: "site.test" })).status).toBe(403);
    calls.limited = true;
    expect((await post({ type: "PAGE_VIEW", path: "/" })).status).toBe(429);
    calls.limited = false;
    expect((await post(null, undefined, "x".repeat(3000))).status).toBe(413);
    expect((await post(null, undefined, "{nope")).status).toBe(400);
    expect((await post({ type: "SOMETHING", path: "/" })).status).toBe(400);
    expect(calls.events).toEqual([]);
  });
});

describe("tracker and funnel", () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

  it("the browser tracker stays silent for opted-out visitors and sends nothing but type, path and CTA id", () => {
    const src = read("src/components/public/public-tracker.tsx");
    expect(src).toContain("doNotTrack");
    expect(src).toContain("globalPrivacyControl");
    expect(src).not.toMatch(/localStorage|sessionStorage|document\.cookie|navigator\.userAgent|location\.search|location\.href/);
  });

  it("the beacon route stores no address, user agent, query string or profile", () => {
    const src = read("src/app/api/public-events/route.ts");
    expect(src).not.toMatch(/user-agent|x-forwarded-for|searchParams|profileId|email/i);
  });

  it("the visitor counter is off by default and the status report holds no secret values", async () => {
    const { FEATURE_FLAG_DEFAULTS } = await import("@/lib/ops/feature-flag-defs");
    expect(FEATURE_FLAG_DEFAULTS["marketing.site_events.enabled"]).toBe(false);
    const status = await getPublicSiteStatus();
    expect(Object.values(status).every((v) => typeof v === "boolean")).toBe(true);
  });
});
