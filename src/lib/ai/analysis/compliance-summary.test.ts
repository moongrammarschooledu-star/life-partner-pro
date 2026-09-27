import { describe, it, expect } from "vitest";
import { buildComplianceSummary, COMPLIANCE_REVIEW_LABEL, type ComplianceSummaryInput } from "./compliance-summary";

function input(overrides: Partial<ComplianceSummaryInput> = {}): ComplianceSummaryInput {
  return {
    jurisdictionCount: 0,
    activeRuleCount: 0,
    rulesDueForReview: [],
    processorsDueForReview: [],
    authorityRequestsAwaitingReview: [],
    holdsPendingRelease: [],
    ...overrides,
  };
}

describe("buildComplianceSummary", () => {
  it("flags an empty jurisdiction table as MISSING rather than silently reporting nothing", () => {
    const payload = buildComplianceSummary(input());
    expect(payload.sufficiency).toBe("LIMITED");
    expect(payload.missingInformation.some((m) => /no jurisdictions/i.test(m))).toBe(true);
  });

  it("never asserts compliance itself — only describes configuration on file", () => {
    const payload = buildComplianceSummary(input({ jurisdictionCount: 2, activeRuleCount: 5 }));
    const allText = JSON.stringify(payload).toLowerCase();
    expect(allText).not.toMatch(/is compliant|compliance confirmed|legally required/);
  });

  it("carries the human-review label in its data", () => {
    const payload = buildComplianceSummary(input());
    expect(payload.data?.reviewLabel).toBe(COMPLIANCE_REVIEW_LABEL);
  });

  it("is SUFFICIENT only when jurisdictions/rules exist and nothing is flagged for review", () => {
    const payload = buildComplianceSummary(input({ jurisdictionCount: 1, activeRuleCount: 1 }));
    expect(payload.sufficiency).toBe("SUFFICIENT");
    expect(payload.suggestedNextStep).toMatch(/no open items/i);
  });

  it("surfaces due-for-review rules, processors, authority requests and pending hold releases as verification questions", () => {
    const payload = buildComplianceSummary(
      input({
        jurisdictionCount: 1,
        activeRuleCount: 1,
        rulesDueForReview: [{ ruleCode: "LPP-CRULE-000001", jurisdictionCode: "PK", requirementType: "AGE_MINIMUM", reviewDate: new Date("2026-01-01") }],
        processorsDueForReview: [{ processorCode: "LPP-PROC-000001", name: "Acme KYC", complianceStatus: "REVIEW_REQUIRED", nextReviewDue: new Date("2026-01-01") }],
        authorityRequestsAwaitingReview: [{ requestCode: "LPP-AUTHREQ-000001", authority: "Local Police", legalReviewStatus: "PENDING", deadline: null }],
        holdsPendingRelease: [{ id: "hold1", reason: "court order" }],
      })
    );
    expect(payload.sufficiency).toBe("PARTIAL");
    expect(payload.verificationQuestions).toHaveLength(4);
    expect(payload.findings?.filter((f) => f.label === "NEEDS_VERIFICATION")).toHaveLength(4);
  });
});
