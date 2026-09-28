import { describe, it, expect } from "vitest";
import { buildRiskCaseSummary, RISK_REVIEW_LABEL, type RiskCaseSummaryInput } from "./risk-summary";
import { checkText } from "@/lib/ai/safety";

const base: RiskCaseSummaryInput = {
  riskCode: "LPP-RISK-000001",
  status: "UNDER_INVESTIGATION",
  riskLevel: "HIGH",
  category: "DUPLICATE",
  openedBy: "assessment",
  subjectKind: "APPLICANT",
  ageHours: 30.4,
  overdue: false,
  signals: [{ type: "DUPLICATE_PROFILE_SUSPECTED", severity: "HIGH", confidence: "HIGH", status: "OPEN" }],
  evidenceTypes: ["AUDIT_EVENT"],
  evidenceIntegrityIssues: 0,
  reviewDecisions: ["ACKNOWLEDGE"],
  hasActiveRestrictions: false,
  linkedDuplicateCluster: true,
  falsePositiveSignals: 0,
  cappedBySingleSignal: false,
};

describe("buildRiskCaseSummary", () => {
  it("is labelled as AI-assisted and human-review-required", () => {
    expect(buildRiskCaseSummary(base).data).toMatchObject({ reviewLabel: RISK_REVIEW_LABEL });
    expect(RISK_REVIEW_LABEL).toMatch(/Human Review Required/);
  });

  it("describes records and never concludes or recommends adverse action", () => {
    const out = buildRiskCaseSummary(base);
    const text = JSON.stringify(out).toLowerCase();
    for (const banned of ["fraudster", "scammer", "is guilty", "should be suspended", "should be banned", "should be rejected", "criminal", "liar", "recommend suspending", "recommend restricting"]) {
      expect(text, banned).not.toContain(banned);
    }
    expect(out.suggestedNextStep).toMatch(/decide the next step yourself/);
    expect(out.summary).toMatch(/no action has been taken/);
  });

  it("never includes a numeric score, contact details or free text — only metadata fields", () => {
    const out = buildRiskCaseSummary(base);
    const labels = out.evidence.map((e) => e.label);
    expect(labels.join(" ")).not.toMatch(/score/i);
    expect(JSON.stringify(out)).not.toMatch(/\+92|@|\d{10}/);
  });

  it("raises the innocent-explanation question and flags thin evidence honestly", () => {
    const out = buildRiskCaseSummary({ ...base, signals: [], evidenceTypes: [] });
    expect(out.verificationQuestions.join(" ")).toMatch(/shared family device/i);
    expect(out.missingInformation).toEqual(["No signals are linked to this case.", "No evidence has been attached yet."]);
    expect(out.sufficiency).toBe("LIMITED");
  });

  it("surfaces prior false positives, single-signal capping and integrity failures as things to examine", () => {
    const out = buildRiskCaseSummary({ ...base, falsePositiveSignals: 2, cappedBySingleSignal: true, evidenceIntegrityIssues: 1, overdue: true, hasActiveRestrictions: true });
    const joined = out.potentialConflicts.join(" ") + out.verificationQuestions.join(" ");
    expect(joined).toMatch(/false positives/);
    expect(joined).toMatch(/single low-confidence/);
    expect(joined).toMatch(/integrity check/);
    expect(joined).toMatch(/past its review due date/);
    expect(joined).toMatch(/end date/);
  });

  it("describes a staff-subject case without naming anyone", () => {
    const out = buildRiskCaseSummary({ ...base, subjectKind: "STAFF", category: "ADMIN_ACCESS" });
    expect(out.evidence.find((e) => e.label === "Subject")?.value).toMatch(/Staff account/);
  });
});

describe("ADVERSE_DECISION safety rule", () => {
  it.each([
    "This account should be suspended immediately.",
    "The profile must be banned.",
    "We should suspend this account today.",
    "The user is guilty of misconduct.",
    "He intends to deceive members.",
    "This member deserves to be removed.",
  ])("rewrites: %s", (text) => {
    const out = checkText(text);
    expect(out.events.some((e) => e.rule === "ADVERSE_DECISION")).toBe(true);
    expect(out.text).toMatch(/authorised human reviewer/);
    expect(out.text).not.toMatch(/suspended immediately|must be banned|suspend this account|is guilty|intends to deceive|deserves to be removed/i);
  });

  it("leaves neutral review language untouched", () => {
    const out = checkText("Signals were linked to this case and a reviewer should look at the evidence.");
    expect(out.events.some((e) => e.rule === "ADVERSE_DECISION")).toBe(false);
  });
});
