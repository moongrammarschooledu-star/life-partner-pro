import { describe, it, expect } from "vitest";
import { computeVerificationLevel, type VerificationLevelFactors } from "./level";

function factors(overrides: Partial<VerificationLevelFactors> = {}): VerificationLevelFactors {
  return {
    phoneVerified: false,
    emailVerified: false,
    adminReviewCompleted: false,
    identityVerified: false,
    hasOpenHighOrCriticalFlag: false,
    enhancedAvailable: false,
    enhancedCompleted: false,
    ...overrides,
  };
}

describe("computeVerificationLevel", () => {
  it("is 0 with nothing verified", () => {
    expect(computeVerificationLevel(factors())).toBe(0);
  });

  it("is 1 once both phone and email are verified", () => {
    expect(computeVerificationLevel(factors({ phoneVerified: true, emailVerified: true }))).toBe(1);
  });

  it("stays 0 with only one of phone/email verified", () => {
    expect(computeVerificationLevel(factors({ phoneVerified: true }))).toBe(0);
  });

  it("is 2 once the admin review is complete", () => {
    expect(computeVerificationLevel(factors({ phoneVerified: true, emailVerified: true, adminReviewCompleted: true }))).toBe(2);
  });

  it("is 3 once identity is verified on top of admin review", () => {
    expect(computeVerificationLevel(factors({ adminReviewCompleted: true, identityVerified: true }))).toBe(3);
  });

  it("never reaches 4 when no enhanced tier is available, even with everything else complete", () => {
    expect(computeVerificationLevel(factors({ adminReviewCompleted: true, identityVerified: true, enhancedCompleted: true }))).toBe(3);
  });

  it("reaches 4 only when enhanced is available AND completed AND identity/review are done", () => {
    expect(
      computeVerificationLevel(factors({ adminReviewCompleted: true, identityVerified: true, enhancedAvailable: true, enhancedCompleted: true }))
    ).toBe(4);
  });

  it("an open high/critical flag caps the level even if everything else is complete", () => {
    expect(
      computeVerificationLevel(
        factors({ phoneVerified: true, emailVerified: true, adminReviewCompleted: true, identityVerified: true, hasOpenHighOrCriticalFlag: true })
      )
    ).toBe(1);
  });

  it("an open high/critical flag caps at 0 if contact isn't even verified", () => {
    expect(computeVerificationLevel(factors({ adminReviewCompleted: true, hasOpenHighOrCriticalFlag: true }))).toBe(0);
  });
});
