import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

// STEP 34 §4 - the environment inventory cannot silently fall behind the code: every variable the shipped code reads is named in
// docs/ENVIRONMENT_VARIABLES.md and in .env.example, and .env.example holds no value that looks like a real secret.
const ROOT = process.cwd();
const PLATFORM = /^(NODE_ENV|NEXT_RUNTIME|VERCEL_.*|GITHUB_.*|CI|PATH|HOME|TEMP|TMP|COMMIT_SHA|BASE_URL|EVIDENCE_URL|SECRET|NEXT_PHASE|TZ)$/;
const PLACEHOLDER = /change-me|PASSWORD@HOST/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".next") continue;
    const f = join(dir, e);
    if (statSync(f).isDirectory()) walk(f, out);
    else if (/\.(ts|tsx|mjs)$/.test(e) && !/\.test\.(ts|tsx)$/.test(e)) out.push(f);
  }
  return out;
}

describe("environment inventory", () => {
  const names = new Set<string>();
  for (const f of [...walk(join(ROOT, "src")), ...walk(join(ROOT, "scripts"))]) {
    for (const m of readFileSync(f, "utf8").matchAll(/\bprocess\.env\.([A-Z][A-Z0-9_]{2,})/g)) names.add(m[1]);
  }
  const doc = readFileSync(join(ROOT, "docs", "ENVIRONMENT_VARIABLES.md"), "utf8");
  const example = readFileSync(join(ROOT, ".env.example"), "utf8");
  const exampleNames = new Set([...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));

  it("finds the variables the code reads", () => {
    expect(names.size).toBeGreaterThan(30);
  });

  it("documents every variable in docs/ENVIRONMENT_VARIABLES.md", () => {
    expect([...names].filter((n) => !PLATFORM.test(n) && !doc.includes(n))).toEqual([]);
  }, 60_000);

  it("lists every non-platform variable in .env.example", () => {
    expect([...names].filter((n) => !PLATFORM.test(n) && n !== "APP_VERSION" && !exampleNames.has(n))).toEqual([]);
  }, 60_000);

  it("has no value that looks like a real secret in .env.example", () => {
    const bad = example.split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=\s*"?(sk_live_|sk_test_[A-Za-z0-9]{10,}|postgres(ql)?:\/\/[^\s"]+:[^\s"@]+@|[A-Za-z0-9+/_-]{40,})/.test(l) && !PLACEHOLDER.test(l));
    expect(bad).toEqual([]);
  });
});
