import { describe, it, expect } from "vitest";
import { isEligibleForPaymentBeta, hashToPercentBucket } from "./rollout";

describe("hashToPercentBucket", () => {
  it("is deterministic for the same profile id", () => {
    const a = hashToPercentBucket("profile-123");
    const b = hashToPercentBucket("profile-123");
    expect(a).toBe(b);
  });
  it("returns a value in [0, 100)", () => {
    for (const id of ["a", "b", "profile-xyz", "another-one"]) {
      const bucket = hashToPercentBucket(id);
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(100);
    }
  });
  it("spreads different ids across different buckets (not all identical)", () => {
    const buckets = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map(hashToPercentBucket));
    expect(buckets.size).toBeGreaterThan(1);
  });
});

describe("isEligibleForPaymentBeta", () => {
  const baseConfig = { betaPercentage: 0, allowedProfileIds: null, allowedCountries: null, allowedPackageIds: null };

  it("rejects everyone when percentage is 0 and no allowlist matches", () => {
    expect(isEligibleForPaymentBeta({ id: "profile-1", country: "PK" }, null, baseConfig)).toBe(false);
  });

  it("allows everyone when percentage is 100", () => {
    expect(isEligibleForPaymentBeta({ id: "profile-1", country: "PK" }, null, { ...baseConfig, betaPercentage: 100 })).toBe(true);
  });

  it("an explicit profile-id allowlist entry overrides percentage/country", () => {
    const config = { ...baseConfig, betaPercentage: 0, allowedProfileIds: ["profile-1"], allowedCountries: ["US"] };
    expect(isEligibleForPaymentBeta({ id: "profile-1", country: "PK" }, null, config)).toBe(true);
  });

  it("rejects a profile from a country not on the allowlist", () => {
    const config = { ...baseConfig, betaPercentage: 100, allowedCountries: ["US"] };
    expect(isEligibleForPaymentBeta({ id: "profile-1", country: "PK" }, null, config)).toBe(false);
  });

  it("allows a profile from an allowed country when percentage permits", () => {
    const config = { ...baseConfig, betaPercentage: 100, allowedCountries: ["PK"] };
    expect(isEligibleForPaymentBeta({ id: "profile-1", country: "PK" }, null, config)).toBe(true);
  });

  it("rejects a package not on the allowlist even if country/percentage pass", () => {
    const config = { ...baseConfig, betaPercentage: 100, allowedPackageIds: ["pkg-a"] };
    expect(isEligibleForPaymentBeta({ id: "profile-1", country: "PK" }, "pkg-b", config)).toBe(false);
    expect(isEligibleForPaymentBeta({ id: "profile-1", country: "PK" }, "pkg-a", config)).toBe(true);
  });

  it("is deterministic — the same profile always gets the same eligibility result", () => {
    const config = { ...baseConfig, betaPercentage: 50 };
    const first = isEligibleForPaymentBeta({ id: "profile-stable", country: "PK" }, null, config);
    const second = isEligibleForPaymentBeta({ id: "profile-stable", country: "PK" }, null, config);
    expect(first).toBe(second);
  });
});
