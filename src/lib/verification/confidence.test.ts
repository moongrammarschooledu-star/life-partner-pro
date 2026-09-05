import { describe, it, expect } from "vitest";
import { computeConfidence } from "./confidence";

const base = {
  phoneVerified: false,
  emailVerified: false,
  checklistCompletionRatio: 0,
  adminReviewCompleted: false,
  documentVerificationEnabled: false,
  documentVerificationApproved: false,
  hasOpenHighOrCriticalFlag: false,
};

describe("computeConfidence", () => {
  it("returns LOW when nothing is verified", () => {
    expect(computeConfidence(base)).toBe("LOW");
  });

  it("returns HIGH when everything applicable is satisfied", () => {
    expect(
      computeConfidence({
        ...base,
        phoneVerified: true,
        emailVerified: true,
        checklistCompletionRatio: 1,
        adminReviewCompleted: true,
      })
    ).toBe("HIGH");
  });

  it("returns MEDIUM for partial completion", () => {
    expect(
      computeConfidence({
        ...base,
        phoneVerified: true,
        emailVerified: true,
        checklistCompletionRatio: 0,
        adminReviewCompleted: false,
      })
    ).toBe("MEDIUM");
  });

  it("forces LOW when an open high/critical flag exists, regardless of other factors", () => {
    expect(
      computeConfidence({
        ...base,
        phoneVerified: true,
        emailVerified: true,
        checklistCompletionRatio: 1,
        adminReviewCompleted: true,
        hasOpenHighOrCriticalFlag: true,
      })
    ).toBe("LOW");
  });

  it("counts document verification as its own factor only when enabled", () => {
    // 3 of 4 applicable factors satisfied (checklist at 0) => 75% => MEDIUM.
    const withoutDocs = computeConfidence({
      ...base,
      phoneVerified: true,
      emailVerified: true,
      checklistCompletionRatio: 0,
      adminReviewCompleted: true,
      documentVerificationEnabled: false,
    });
    // Adding an approved document as a 5th applicable, satisfied factor
    // tips the ratio to 80% => HIGH, proving the factor is actually counted.
    const withDocsApproved = computeConfidence({
      ...base,
      phoneVerified: true,
      emailVerified: true,
      checklistCompletionRatio: 0,
      adminReviewCompleted: true,
      documentVerificationEnabled: true,
      documentVerificationApproved: true,
    });
    expect(withoutDocs).toBe("MEDIUM");
    expect(withDocsApproved).toBe("HIGH");
  });
});
