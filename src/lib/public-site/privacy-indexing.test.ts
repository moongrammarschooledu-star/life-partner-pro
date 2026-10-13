import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { PRIVATE_NOINDEX_PATHS, PRIVATE_PATH_PREFIXES } from "@/lib/public-site/routes";

// STEP 35 §25 / §49 / §50: private matrimonial pages must never be indexable. Two independent layers (robots.txt and an X-Robots-Tag header)
// plus the rule that no public page lists a private profile, so a new account page cannot slip out unprotected.

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("private areas are noindex", () => {
  it("every my-* account folder, /dashboard, /family and /admin carries the noindex header list", () => {
    const folders = readdirSync(join(ROOT, "src/app/(public)"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => `/${d.name}`);
    for (const f of folders.filter((x) => x.startsWith("/my-"))) expect(PRIVATE_NOINDEX_PATHS as readonly string[], f).toContain(f);
    for (const p of ["/dashboard", "/account-settings", "/family", "/admin", "/maintenance"]) expect(PRIVATE_NOINDEX_PATHS as readonly string[], p).toContain(p);
    for (const p of PRIVATE_NOINDEX_PATHS) expect(existsSync(join(ROOT, "src/app", p === "/admin" || p === "/family" || p === "/maintenance" ? p : `(public)${p}`)), p).toBe(true);
  });

  it("next.config.ts turns that list into X-Robots-Tag: noindex for the path and everything below it", () => {
    const cfg = read("next.config.ts");
    expect(cfg).toContain("PRIVATE_NOINDEX_PATHS");
    expect(cfg).toContain("X-Robots-Tag");
    expect(cfg).toContain("noindex, nofollow, noarchive");
    expect(cfg).toContain("`${p}/:path*`");
  });

  it("robots.txt blocks every prefix the spec names", () => {
    for (const p of ["/admin", "/dashboard", "/family", "/api/", "/private", "/internal"]) expect(PRIVATE_PATH_PREFIXES as readonly string[], p).toContain(p);
  });
});

describe("no public applicant directory", () => {
  it("there is no public page or route that lists, searches or shows applicant profiles", () => {
    const publicRoutes = readdirSync(join(ROOT, "src/app/(public)"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    for (const name of publicRoutes) expect(name, name).not.toMatch(/^(profiles?|members?|directory|browse|search|candidates?)$/);
    expect(existsSync(join(ROOT, "src/app/api/public-profiles"))).toBe(false);
  });

  it("no dating or social features exist on the public site: no swipe, public like, follower or comment code", () => {
    const files = ["src/app/(public)/page.tsx", "src/components/public/navbar.tsx", "src/components/public/footer.tsx"];
    for (const f of files) expect(read(f), f).not.toMatch(/swipe|follower|\blike button|public comment/i);
  });

  it("public-site analytics and structured data never carry matrimonial attributes", () => {
    const sources = [read("src/lib/public-site/site-events.ts"), read("src/lib/public-site/funnel.ts"), read("src/lib/public-site/structured-data.ts"), read("src/app/api/public-events/route.ts")].join("\n");
    expect(sources).not.toMatch(/religion|sect\b|income|health|matchScore|riskScore|proposal(Code|Id)|dateOfBirth|mobileNumber/i);
  });

  it("no advertising or tracking script is loaded by the public site", () => {
    for (const f of ["src/app/layout.tsx", "src/app/(public)/layout.tsx", "src/components/public/public-tracker.tsx"]) {
      expect(read(f), f).not.toMatch(/googletagmanager|google-analytics|connect\.facebook|fbq\(|gtag\(|hotjar|clarity\.ms|ttq\./i);
    }
  });
});
