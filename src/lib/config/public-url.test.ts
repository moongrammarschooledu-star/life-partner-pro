import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { publicOrigin, publicUrl, PublicUrlNotConfiguredError } from "@/lib/config/public-url";

// STEP 34 §5/§42 — every link that leaves the system uses the canonical https domain.

describe("publicOrigin / publicUrl", () => {
  it("prefers APP_URL and returns only the origin", () => {
    expect(publicOrigin({ APP_URL: "https://www.example.com/some/path?x=1", NEXTAUTH_URL: "https://other.example" })).toBe("https://www.example.com");
  });

  it("falls back through the older settings in order", () => {
    expect(publicOrigin({ NEXT_PUBLIC_APP_URL: "https://a.example" })).toBe("https://a.example");
    expect(publicOrigin({ NEXTAUTH_URL: "https://b.example" })).toBe("https://b.example");
    expect(publicOrigin({ VERCEL_PROJECT_PRODUCTION_URL: "lifepartnerpro.vercel.app" })).toBe("https://lifepartnerpro.vercel.app");
  });

  it("builds an absolute link and normalises the path", () => {
    expect(publicUrl("/family/register?code=A", { APP_URL: "https://x.example" })).toBe("https://x.example/family/register?code=A");
    expect(publicUrl("dashboard", { APP_URL: "https://x.example" })).toBe("https://x.example/dashboard");
  });

  it("in production with nothing configured it refuses instead of producing a relative or localhost link", () => {
    expect(() => publicUrl("/x", { NODE_ENV: "production" })).toThrow(PublicUrlNotConfiguredError);
    expect(() => publicUrl("/x", { VERCEL_ENV: "production" })).toThrow(PublicUrlNotConfiguredError);
  });

  it("in production an http address is refused", () => {
    expect(() => publicUrl("/x", { APP_ENV: "production", APP_URL: "http://example.com" })).toThrow(PublicUrlNotConfiguredError);
  });

  it("ignores a malformed value and uses the next one", () => {
    expect(publicOrigin({ APP_URL: "not a url ::", NEXTAUTH_URL: "https://ok.example" })).toBe("https://ok.example");
  });

  it("outside production the development address is used", () => {
    expect(publicUrl("/x", { NODE_ENV: "development" })).toBe("http://localhost:3000/x");
  });
});

describe("no e-mailed link is built from a possibly empty setting", () => {
  const SRC = join(process.cwd(), "src");
  const walk = (d: string, out: string[] = []): string[] => {
    for (const e of readdirSync(d)) {
      const f = join(d, e);
      if (statSync(f).isDirectory()) walk(f, out);
      else if (/\.tsx?$/.test(e) && !/\.test\./.test(e)) out.push(f);
    }
    return out;
  };

  it("no module concatenates process.env.*URL with an empty fallback to make a link", () => {
    const bad = walk(join(SRC, "lib")).concat(walk(join(SRC, "app", "api"))).filter((f) => /process\.env\.(NEXTAUTH_URL|APP_URL|NEXT_PUBLIC_APP_URL)\s*\?\?\s*(""|'')/.test(readFileSync(f, "utf8")));
    expect(bad.map((f) => f.replace(SRC, ""))).toEqual([]);
  }, 60_000);

  it("no shipped code hard-codes a localhost address (outside the development fallback in public-url.ts)", () => {
    const bad = walk(join(SRC, "lib")).concat(walk(join(SRC, "app"))).filter((f) => !f.endsWith(join("config", "public-url.ts")) && /localhost:\d+|127\.0\.0\.1/.test(readFileSync(f, "utf8")));
    expect(bad.map((f) => f.replace(SRC, ""))).toEqual([]);
  }, 60_000);
});
