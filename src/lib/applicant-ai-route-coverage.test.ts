import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";

// STEP 21 — the applicant-facing AI surface (src/lib/ai/applicant-features.ts,
// exposed only at /api/my-ai/*) is a separate, minimal, rule-based-only path
// from the admin AI pipeline (see that file's own top-of-file disclosure).
// This mirrors the spirit of route-auth-coverage.test.ts's "AI API routes"
// block, scoped to the applicant side instead of /api/admin/ai/*.

const API_ROOT = join(process.cwd(), "src", "app", "api", "my-ai");

function walk(dir: string, out: string[] = []): string[] {
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (entry === "route.ts") out.push(full);
    }
  } catch {
    // directory doesn't exist yet — no /api/my-ai routes to check
  }
  return out;
}

const aiRoutes = walk(API_ROOT).map((file) => ({
  path: "/api/my-ai/" + relative(API_ROOT, file).split(sep).slice(0, -1).join("/"),
  source: readFileSync(file, "utf8"),
}));

const applicantFeaturesSource = readFileSync(join(process.cwd(), "src", "lib", "ai", "applicant-features.ts"), "utf8");
const applicantFeaturesImports = applicantFeaturesSource
  .split("\n")
  .filter((line) => /^\s*import /.test(line))
  .join("\n");

describe("applicant-facing AI route coverage", () => {
  it("every /api/my-ai route verifies the applicant session", () => {
    const missing = aiRoutes.filter((r) => !/requireApplicantProfileId\(/.test(r.source)).map((r) => r.path);
    expect(missing).toEqual([]);
  });

  it("applicant-features.ts never imports a provider, the admin pipeline, or route-guard (heavy NextAuth chain)", () => {
    const forbidden = /@\/lib\/ai\/providers|@\/lib\/ai\/pipeline|@\/lib\/ai\/load"|@\/lib\/route-guard/;
    expect(applicantFeaturesImports).not.toMatch(forbidden);
  });

  it("applicant-features.ts runs its output through the safety filter", () => {
    expect(applicantFeaturesSource).toMatch(/applySafetyRules\(/);
  });

  it("applicant-features.ts checks internal AI consent before running analysis", () => {
    expect(applicantFeaturesSource).toMatch(/loadConsentDecision\(/);
  });
});
