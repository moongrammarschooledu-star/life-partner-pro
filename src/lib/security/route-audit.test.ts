import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import { join } from "path";

// STEP 33 — the per-handler route audit (scripts/audit-routes.mjs) as a standing guard. It reads source only. It complements the file-level
// coverage test: that one proves a route FILE mentions an authentication call; this one looks at each HTTP handler separately.

interface Finding { path: string; method: string; guard: string; permission: string | null; mutating: boolean; notes: string[]; severity: string }

const out = execFileSync(process.execPath, [join(process.cwd(), "scripts", "audit-routes.mjs"), "--json"], { cwd: process.cwd(), encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
const report = JSON.parse(out) as { summary: { routes: number; handlers: number; severities: Record<string, number> }; findings: Finding[] };

describe("per-handler route audit (STEP 33)", () => {
  it("parses the route tree (sanity)", () => {
    expect(report.summary.routes).toBeGreaterThan(600);
    expect(report.summary.handlers).toBeGreaterThan(report.summary.routes);
  });

  it("has no CRITICAL or HIGH finding", () => {
    const bad = report.findings.filter((f) => f.severity === "CRITICAL" || f.severity === "HIGH").map((f) => `${f.method} ${f.path}: ${f.notes.join("; ")}`);
    expect(bad).toEqual([]);
  });

  it("no administrator handler leaves its permission unstated: either a named permission, an inline permission check, or the AI pipeline", () => {
    const bad = report.findings.filter((f) => f.notes.some((n) => n.startsWith("requireAdmin() without a permission and no inline"))).map((f) => `${f.method} ${f.path}`);
    expect(bad).toEqual([]);
  });

  it("no handler that takes an identifier from the URL ignores who is calling (applicant and family)", () => {
    const bad = report.findings.filter((f) => f.notes.some((n) => n.startsWith("IDOR check"))).map((f) => `${f.method} ${f.path}`);
    // /api/my-guide/[slug] serves the same public guide text to every applicant: the slug names a page, not a record.
    expect(bad.filter((p) => !p.endsWith("/api/my-guide/[slug]"))).toEqual([]);
  });

  it("no handler returns a raw error message or stack trace to the caller", () => {
    const bad = report.findings.filter((f) => f.notes.some((n) => /raw error|stack trace/.test(n))).map((f) => `${f.method} ${f.path}`);
    expect(bad).toEqual([]);
  });

  it("no unsafe raw SQL in a route", () => {
    expect(report.findings.filter((f) => f.notes.some((n) => /raw SQL/.test(n))).map((f) => f.path)).toEqual([]);
  });
});
