import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

// The spec's separation rules, pinned structurally so a future change cannot quietly break them:
//   - payment status and risk data must never influence matrimonial compatibility;
//   - matching/scoring must not depend on the risk or security-event modules;
//   - risk scoring must not consume matching scores or compatibility outputs.

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const MATCHING_FILES = [
  join(ROOT, "src/lib/matching.ts"),
  join(ROOT, "src/lib/match-adapter.ts"),
  join(ROOT, "src/lib/matching-eligibility.ts"),
  ...walk(join(ROOT, "src/lib/search")),
];

describe("payment / risk ↔ compatibility firewall", () => {
  it("no matching or search module imports the risk, security-event or finance modules", () => {
    for (const file of MATCHING_FILES) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/from ["']@\/lib\/(risk|security)\b/);
      expect(text, file).not.toMatch(/from ["']@\/lib\/finance\b/);
      expect(text, file).not.toMatch(/securityFlag|riskCase|riskAssessment|userReport|payment\./);
    }
  });

  it("risk modules never import the matching engine or read compatibility scores", () => {
    for (const file of [...walk(join(ROOT, "src/lib/risk")), ...walk(join(ROOT, "src/lib/security"))]) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/from ["']@\/lib\/(matching|match-adapter|matching-eligibility|search)\b/);
      expect(text, file).not.toMatch(/compatibilityScore|matchScore|matchingScore/i);
    }
  });

  it("the payment-derived signals are a risk-only category and their factors are weak on their own", async () => {
    const { FACTOR_DEFINITIONS } = await import("./config");
    for (const key of ["PAYMENT_ANOMALY_SIGNAL", "REPEATED_PAYMENT_FAILURE"]) {
      expect(FACTOR_DEFINITIONS[key].category).toBe("PAYMENT");
      expect(FACTOR_DEFINITIONS[key].weight * 1).toBeLessThan(20); // can never reach MEDIUM alone
      expect(FACTOR_DEFINITIONS[key].immediateControl).toBe(false);
    }
  });

  it("risk restrictions that touch matching are ordinary, human-applied restrictions only", () => {
    // The matching routes consult hasActiveRestriction(); nothing in the rule engine writes one.
    const engine = readFileSync(join(ROOT, "src/lib/risk/rule-engine.ts"), "utf8");
    expect(engine).not.toMatch(/CANNOT_MATCH|restriction/i);
  });
});

describe("applicant-facing surfaces never carry risk data", () => {
  it("the applicant privacy export contains no risk, signal, duplicate or report data", () => {
    const text = readFileSync(join(ROOT, "src/lib/privacy/data-export.ts"), "utf8");
    expect(text).not.toMatch(/securityFlag|riskCase|riskAssessment|riskEvidence|duplicateCandidate|duplicateCluster|securityEvent|userReport|accountRelationship/);
  });

  it("no /api/my-* route or applicant page reads risk cases, assessments, signals or evidence", () => {
    const dirs = [join(ROOT, "src/app/api"), join(ROOT, "src/app/(applicant)"), join(ROOT, "src/app/dashboard")];
    const offenders: string[] = [];
    for (const dir of dirs) {
      let files: string[] = [];
      try {
        files = walk(dir);
      } catch {
        continue;
      }
      for (const file of files) {
        const rel = file.replace(ROOT, "").replace(/\\/g, "/");
        const applicantFacing = /\/api\/(my-|family\/|register|support|update-request|verify\/)/.test(rel) || /\/(applicant|dashboard)\b/.test(rel);
        if (!applicantFacing || rel.includes("/api/admin/")) continue;
        const text = readFileSync(file, "utf8");
        if (/prisma\.(riskCase|riskAssessment|riskEvidence|riskReview|securityEvent|securityIncident|duplicateCluster)\b/.test(text) || /from ["']@\/lib\/risk\/(case|assessment|evidence|duplicate|rule|signal|relationship|technical)/.test(text)) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
