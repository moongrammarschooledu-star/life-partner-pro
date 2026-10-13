import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    landingPage: { findMany: async () => [{ slug: "spring", updatedAt: new Date("2026-01-01") }] },
    contentPost: { findMany: async () => [{ type: "ARTICLE", slug: "how-profiles-work", updatedAt: new Date("2026-02-01") }, { type: "GUIDE", slug: "first-meeting", updatedAt: new Date("2026-03-01") }] },
  },
}));
vi.mock("@/lib/ops/feature-flags", () => ({ isFeatureEnabled: async () => true }));

import { PUBLIC_ROUTES, PRIVATE_PATH_PREFIXES, findPublicRoute, isApplicantAppPath } from "@/lib/public-site/routes";
import { pageMetadata, contentMetadata } from "@/lib/public-site/seo";
import { organizationLd, websiteLd, webPageLd, breadcrumbLd, faqLd, articleLd, serializeJsonLd } from "@/lib/public-site/structured-data";
import { FAQ_CATEGORIES, allFaqItems } from "@/lib/public-site/faq";
import { installPromptVisible, INSTALL_MIN_PAGEVIEWS } from "@/lib/public-site/install-policy";
import { billingPeriodLabel, priceLabel } from "@/lib/public-site/pricing-display";
import { legalPagesReviewed, governingLawText } from "@/lib/public-site/legal";
import { contactSchema } from "@/lib/public-site/contact";
import { APPLICANT_BOTTOM_NAV, applicantBottomNavVisible } from "@/lib/public-site/mobile-nav";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";
import manifest from "@/app/manifest";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

function pageFileFor(path: string): string | null {
  const dir = path === "/" ? "" : path;
  const candidates = [`src/app/(public)${dir}/page.tsx`, `src/app/(public)${dir}/layout.tsx`];
  return candidates.find((c) => existsSync(join(ROOT, c))) ?? null;
}

describe("public route registry", () => {
  it("has unique paths and unique titles", () => {
    expect(new Set(PUBLIC_ROUTES.map((r) => r.path)).size).toBe(PUBLIC_ROUTES.length);
    expect(new Set(PUBLIC_ROUTES.map((r) => r.title)).size).toBe(PUBLIC_ROUTES.length);
  });

  it("every route is backed by a real page", () => {
    for (const r of PUBLIC_ROUTES) expect(pageFileFor(r.path), r.path).not.toBeNull();
  });

  it("indexable pages have sensible search snippets (title <= 70, description 60-170 characters)", () => {
    for (const r of PUBLIC_ROUTES.filter((x) => x.indexable)) {
      expect(r.title.length, r.path).toBeLessThanOrEqual(70);
      expect(r.description.length, r.path).toBeGreaterThanOrEqual(60);
      expect(r.description.length, r.path).toBeLessThanOrEqual(170);
    }
  });

  it("sign-in and utility pages are noindex; every page named in the spec exists and is indexable", () => {
    for (const p of ["/login", "/forgot-password", "/report-concern", "/update-request", "/register/confirmation", "/offline"]) expect(findPublicRoute(p)?.indexable, p).toBe(false);
    for (const p of ["/", "/about", "/how-it-works", "/why-life-partner-pro", "/for-applicants", "/for-families", "/verification", "/safety", "/pricing", "/faq", "/contact", "/support", "/blog", "/guides", "/register", "/privacy-policy", "/terms"]) {
      expect(findPublicRoute(p)?.indexable, p).toBe(true);
    }
  });

  it("no public route sits under a private prefix", () => {
    for (const r of PUBLIC_ROUTES) for (const prefix of PRIVATE_PATH_PREFIXES) expect(r.path.startsWith(prefix), `${r.path} vs ${prefix}`).toBe(false);
  });

  it("applicant account paths switch the navigation; marketing paths do not", () => {
    for (const p of ["/dashboard", "/dashboard/profile", "/my-billing", "/my-status", "/account-settings", "/update-request"]) expect(isApplicantAppPath(p), p).toBe(true);
    for (const p of ["/", "/pricing", "/how-it-works", "/login", "/for-families"]) expect(isApplicantAppPath(p), p).toBe(false);
  });
});

describe("route map document", () => {
  it("mentions every route in the registry and every private prefix, so the document cannot drift from the code", () => {
    const doc = read("PUBLIC_ROUTE_MAP.md");
    for (const r of PUBLIC_ROUTES) {
      if (r.path === "/") expect(doc).toContain("| `/` |");
      else expect(doc, r.path).toContain(`\`${r.path}\``);
    }
    for (const p of ["/admin", "/dashboard", "/family", "/account-settings", "/maintenance", "/api"]) expect(doc, p).toContain(p);
  });
});

describe("page metadata", () => {
  it("sets title, description, canonical, Open Graph and Twitter from the registry", () => {
    const m = pageMetadata("/about");
    expect(m.title).toEqual({ absolute: findPublicRoute("/about")!.title });
    expect(m.alternates?.canonical).toBe("/about");
    expect(m.openGraph).toMatchObject({ url: "/about", siteName: "Life Partner Pro" });
    expect(m.twitter).toMatchObject({ card: "summary" });
    expect(m.robots).toEqual({ index: true, follow: true });
  });

  it("noindex pages say so, and an unknown path is an error rather than a silent default", () => {
    expect(pageMetadata("/login").robots).toEqual({ index: false, follow: true });
    expect(() => pageMetadata("/not-a-page")).toThrow();
    expect(contentMetadata({ path: "/blog/x", title: "t", description: "d", indexable: false }).robots).toEqual({ index: false, follow: false });
  });
});

describe("sitemap", () => {
  beforeEach(() => {
    process.env.APP_URL = "https://example.test";
  });
  afterEach(() => {
    delete process.env.APP_URL;
  });

  it("lists every indexable public page and published landing pages, and nothing private", async () => {
    const urls = (await sitemap()).map((e) => e.url);
    for (const r of PUBLIC_ROUTES.filter((x) => x.indexable)) expect(urls).toContain(`https://example.test${r.path === "/" ? "" : r.path}`);
    expect(urls).toContain("https://example.test/lp/spring");
    expect(urls).toContain("https://example.test/blog/how-profiles-work");
    expect(urls).toContain("https://example.test/guides/first-meeting");
    for (const u of urls) {
      const path = new URL(u).pathname;
      for (const prefix of PRIVATE_PATH_PREFIXES) expect(path.startsWith(prefix), u).toBe(false);
      expect(path, u).not.toMatch(/login|forgot-password|offline|confirmation|report-concern|update-request/);
    }
  });

  it("is empty when no canonical base URL is configured, and invents no last-modified dates for fixed pages", async () => {
    const saved = { ...process.env };
    delete process.env.APP_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.NEXTAUTH_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    expect(await sitemap()).toEqual([]);
    Object.assign(process.env, saved);
    process.env.APP_URL = "https://example.test";
    const home = (await sitemap()).find((e) => e.url === "https://example.test");
    expect(home?.lastModified).toBeUndefined();
  });
});

describe("robots", () => {
  it("blocks every private prefix, points at the sitemap, and does not block any public page", () => {
    process.env.APP_URL = "https://example.test";
    const r = robots();
    const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    const disallow = ([] as string[]).concat(rule.disallow ?? []);
    for (const prefix of ["/admin", "/dashboard", "/family", "/api/", "/my-", "/private", "/internal"]) expect(disallow).toContain(prefix);
    for (const route of PUBLIC_ROUTES) expect(disallow.some((d) => route.path.startsWith(d)), route.path).toBe(false);
    expect(r.sitemap).toBe("https://example.test/sitemap.xml");
    delete process.env.APP_URL;
  });
});

describe("structured data", () => {
  it("never carries ratings, reviews, aggregate ratings or invented contact points", () => {
    const all = JSON.stringify([organizationLd(), websiteLd(), webPageLd({ path: "/x", name: "n", description: "d" }), breadcrumbLd([{ name: "Home", path: "/" }]), faqLd(allFaqItems()), articleLd({ path: "/blog/a", headline: "h", description: "d", datePublished: "2026-01-01", authorName: "Team" })]);
    expect(all).not.toMatch(/aggregateRating|"review"|ratingValue|contactPoint|telephone|"email"|sameAs|potentialAction/);
  });

  it("FAQ markup contains exactly the questions that are shown", () => {
    const ld = faqLd(allFaqItems()) as { mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }> };
    expect(ld.mainEntity.map((q) => q.name)).toEqual(allFaqItems().map((q) => q.question));
    expect(ld.mainEntity.map((q) => q.acceptedAnswer.text)).toEqual(allFaqItems().map((q) => q.answer));
  });

  it("escapes anything that could close the script tag", () => {
    const out = serializeJsonLd({ name: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("</script>");
    expect(out).toContain("\\u003c/script>");
  });
});

describe("claims on public pages (spec: no guarantees, no invented numbers or testimonials)", () => {
  function publicSourceFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(join(ROOT, dir))) {
        const rel = `${dir}/${name}`;
        if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
        else if (/\.(tsx|ts)$/.test(name) && !/\.test\./.test(name)) out.push(rel);
      }
    };
    walk("src/app/(public)");
    for (const f of ["src/lib/public-site/faq.ts", "src/lib/public-site/routes.ts", "src/components/public/page-kit.tsx", "src/components/public/legal-page.tsx"]) out.push(f);
    // Account pages (dashboard, my-*, billing) are signed-in product screens, not marketing copy.
    return out.filter((f) => !/\(public\)\/(dashboard|my-|account-settings|my-billing|my-cases|my-notifications|my-privacy|my-proposals|my-status|my-verification)/.test(f));
  }

  it("makes no promise of a guaranteed outcome, and no '100%' or 'perfect match' claim", () => {
    for (const f of publicSourceFiles()) {
      const src = read(f);
      expect(src, f).not.toMatch(/100\s?%/);
      expect(src, f).not.toMatch(/perfect (match|spouse|partner)|best match|success rate|guaranteed (marriage|match|spouse|proposal)/i);
      for (const m of src.matchAll(/guarantee/gi)) {
        const before = src.slice(Math.max(0, (m.index ?? 0) - 60), m.index);
        expect(before, `${f}: "${src.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + 30)}"`).toMatch(/(not|no|never|nor|cannot|without|n't)\s[^.]*$/i);
      }
    }
  });

  it("shows no invented statistics or testimonials", () => {
    for (const f of publicSourceFiles()) {
      const src = read(f);
      expect(src, f).not.toMatch(/\b\d[\d,.]*\+?\s*(happy|successful|verified|active)?\s*(couples|marriages|members|profiles|families|matches)\b/i);
      expect(src, f).not.toMatch(/testimonial|aggregateRating|★|stars?\b/i);
    }
  });

  it("has no link to the admin area from any public page, the navigation or the footer", () => {
    for (const f of [...publicSourceFiles(), "src/components/public/navbar.tsx", "src/components/public/footer.tsx"]) expect(read(f), f).not.toMatch(/href="\/admin/);
  });
});

describe("navigation and footer", () => {
  function hrefs(rel: string): string[] {
    return [...read(rel).matchAll(/href[:=]\s*["{']\s*["']?(\/[a-z0-9\-/#]*)/gi)].map((m) => m[1].split("#")[0]).filter(Boolean);
  }
  const KNOWN_APP_PATHS = ["/dashboard", "/my-verification", "/my-proposals", "/my-notifications", "/my-cases", "/account-settings", "/my-billing", "/update-request", "/report-concern", "/my-status", "/family/dashboard", "/my-privacy"];

  it("every link in the navigation and footer goes to a page that exists", () => {
    for (const rel of ["src/components/public/navbar.tsx", "src/components/public/footer.tsx"]) {
      for (const h of new Set(hrefs(rel))) {
        if (h === "/") continue;
        const exists = findPublicRoute(h) || KNOWN_APP_PATHS.includes(h) || existsSync(join(ROOT, `src/app/(public)${h}/page.tsx`));
        expect(Boolean(exists), `${rel} -> ${h}`).toBe(true);
      }
    }
  });

  it("offers a mobile menu (button with aria-expanded) and the same links on desktop and mobile", () => {
    const nav = read("src/components/public/navbar.tsx");
    expect(nav).toContain("aria-expanded");
    expect(nav).toContain('aria-controls="mobile-menu"');
    expect(nav).toContain("lg:hidden");
    expect(nav).toContain("hidden items-center gap-5 text-sm font-medium lg:flex");
    for (const label of ["How It Works", "Verification", "For Families", "Pricing", "FAQ", "Support", "Login", "Create Profile"]) expect(nav).toContain(label);
  });

  it("the public layout has a skip link and a main landmark with the matching id", () => {
    const layout = read("src/app/(public)/layout.tsx");
    expect(layout).toContain('href="#main-content"');
    expect(layout).toContain('id="main-content"');
  });
});

describe("install prompt policy", () => {
  const base = { canPrompt: true, ios: false, standalone: false, views: INSTALL_MIN_PAGEVIEWS, dismissedUntil: 0, now: 1_000 };
  it("appears on the first page for a visitor who can actually install", () => {
    expect(installPromptVisible(base)).toBe(true);
    expect(installPromptVisible({ ...base, views: 0 })).toBe(false);
    expect(INSTALL_MIN_PAGEVIEWS).toBe(1); // first-time visitors see it straight away
    expect(installPromptVisible({ ...base, canPrompt: false })).toBe(false);
    expect(installPromptVisible({ ...base, canPrompt: false, ios: true })).toBe(true);
  });
  it("never shows inside the installed app and respects a dismissal", () => {
    expect(installPromptVisible({ ...base, standalone: true })).toBe(false);
    expect(installPromptVisible({ ...base, dismissedUntil: 5_000 })).toBe(false);
    expect(installPromptVisible({ ...base, dismissedUntil: 500 })).toBe(true);
  });
});

describe("pricing display", () => {
  const fmt = (a: number, c: string) => `${c} ${a / 100}`;
  it("labels one-time and subscription packages and uses the configured price, never a hard-coded one", () => {
    expect(billingPeriodLabel("ONE_TIME", null)).toBe("One-time payment");
    expect(billingPeriodLabel("RECURRING", 30)).toBe("Subscription, every month");
    expect(billingPeriodLabel("RECURRING", 90)).toBe("Subscription, every 3 months");
    expect(billingPeriodLabel("RECURRING", 365)).toBe("Subscription, every year");
    expect(billingPeriodLabel("RECURRING", 10)).toBe("Subscription, every 10 days");
    expect(priceLabel({ amountMinor: 250000, currencyCode: "PKR" }, fmt)).toEqual({ text: "PKR 2500", isFree: false });
    expect(priceLabel({ amountMinor: 0, currencyCode: "PKR" }, fmt)).toEqual({ text: "PKR 0", isFree: true });
    expect(priceLabel(null, fmt)).toEqual({ text: "Contact us", isFree: false });
  });
  it("the pricing page and component contain no price literals", () => {
    for (const f of ["src/app/(public)/pricing/page.tsx", "src/components/public/pricing-packages.tsx", "src/app/(public)/page.tsx"]) expect(read(f), f).not.toMatch(/\b(PKR|USD|Rs\.?|\$)\s?\d/);
  });
});

describe("legal pages", () => {
  it("show the pending-review notice until the owner confirms review, and a governing-law section only from owner-supplied text", () => {
    expect(legalPagesReviewed({})).toBe(false);
    expect(legalPagesReviewed({ LEGAL_PAGES_REVIEWED: "true" })).toBe(true);
    expect(legalPagesReviewed({ LEGAL_PAGES_REVIEWED: "yes" })).toBe(false);
    expect(governingLawText({})).toBeNull();
    expect(governingLawText({ LEGAL_GOVERNING_LAW: "  Courts of X  " })).toBe("Courts of X");
  });
  it("the privacy policy no longer claims data is never shared with third parties", () => {
    const src = read("src/app/(public)/privacy-policy/page.tsx");
    expect(src).not.toMatch(/do not sell or share your data with third parties/i);
    expect(src).toMatch(/do not sell your personal information/i);
  });
});

describe("FAQ", () => {
  it("covers every category the spec lists", () => {
    expect(FAQ_CATEGORIES.map((c) => c.id)).toEqual(["general", "privacy", "verification", "matching", "proposals", "family", "safety", "membership"]);
    for (const c of FAQ_CATEGORIES) expect(c.items.length).toBeGreaterThan(0);
  });
  it("states that it is not a dating app and that nothing is guaranteed", () => {
    const text = allFaqItems().map((i) => i.answer).join(" ");
    expect(text).toMatch(/not a dating app|No\. There is no swiping/i);
    expect(text).toMatch(/does not guarantee a match/i);
  });
});

describe("contact form schema", () => {
  const good = { category: "PRIVACY", email: "  Person@Example.com ", subject: "Question", message: "Please tell me how deletion works.", consent: true };
  it("accepts a valid enquiry and normalises the e-mail", () => {
    const r = contactSchema.safeParse(good);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.email).toBe("person@example.com");
  });
  it.each([
    ["bad e-mail", { email: "nope" }],
    ["no consent", { consent: false }],
    ["link in message", { message: "Visit https://spam.example now please" }],
    ["too short", { message: "hi" }],
    ["too long", { message: "x".repeat(4001) }],
    ["unknown category", { category: "SALES" }],
    ["bad profile id", { profileCode: "LPP 1; DROP" }],
    ["honeypot filled", { website: "http://bot" }],
  ])("rejects: %s", (_name, patch) => {
    expect(contactSchema.safeParse({ ...good, ...patch }).success).toBe(false);
  });
});

describe("web app manifest and icons", () => {
  it("is installable: standalone display, root scope, 192 and 512 icons and a maskable icon that all exist", () => {
    const m = manifest();
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/");
    expect(m.scope).toBe("/");
    const sizes = (m.icons ?? []).map((i) => `${i.sizes}:${i.purpose}`);
    expect(sizes).toEqual(expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]));
    for (const i of m.icons ?? []) expect(existsSync(join(ROOT, "public", i.src)), i.src).toBe(true);
    for (const f of ["src/app/apple-icon.png", "src/app/opengraph-image.png", "public/sw.js"]) expect(existsSync(join(ROOT, f)), f).toBe(true);
  });
});

describe("mobile applicant navigation", () => {
  it("offers Home, My Profile, Proposals, Notifications and More, each pointing at a page that exists", () => {
    expect(APPLICANT_BOTTOM_NAV.map((i) => i.label)).toEqual(["Home", "My Profile", "Proposals", "Notifications", "More"]);
    for (const i of APPLICANT_BOTTOM_NAV) {
      const dir = i.href === "/dashboard" ? "src/app/(public)/dashboard/page.tsx" : `src/app/(public)${i.href}/page.tsx`;
      expect(existsSync(join(ROOT, dir)), i.href).toBe(true);
    }
  });
  it("shows only on signed-in account pages, never on marketing pages or the sign-in form", () => {
    for (const p of ["/dashboard", "/dashboard/profile", "/my-proposals", "/my-notifications", "/account-settings", "/my-billing/invoices"]) expect(applicantBottomNavVisible(p), p).toBe(true);
    for (const p of ["/", "/pricing", "/login", "/my-status", "/register", "/register/confirmation", "/family/dashboard", "/blog/x"]) expect(applicantBottomNavVisible(p), p).toBe(false);
  });
  it("has no swipe, like, follow or comment controls and keeps privacy settings one tap away", () => {
    const src = read("src/components/public/applicant-bottom-nav.tsx");
    const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n"); // behaviour, not the comment that explains what is left out
    expect(code).not.toMatch(/onTouch|useSwipe|swipe|\blike\b|follow(er)?\b|comment/i);
    expect(APPLICANT_BOTTOM_NAV.some((i) => i.href === "/account-settings")).toBe(true);
  });
});