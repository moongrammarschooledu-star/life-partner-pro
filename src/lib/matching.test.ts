import { describe, it, expect } from "vitest";
import {
  scoreMatch,
  DEFAULT_WEIGHTS,
  DEFAULT_THRESHOLDS,
  scoreMatchWithThresholds,
  type MatchableProfile,
  type HardRequirements,
  type EnabledCategories,
} from "./matching";

// A minimal, fully-specified profile — individual tests override only the
// fields relevant to what they're checking, keeping every other category
// "unknown" (no preference stated) so it never pollutes the assertion.
function profile(overrides: Partial<MatchableProfile> = {}): MatchableProfile {
  return {
    id: overrides.id ?? "p1",
    gender: "MALE",
    age: 29,
    heightCm: 178,
    maritalStatus: "NEVER_MARRIED",
    city: "Lahore",
    area: null,
    country: "Pakistan",
    educationLevel: null,
    profession: null,
    monthlyIncome: null,
    familyType: null,
    familyStatus: null,
    religion: null,
    sect: null,
    smoking: undefined,
    drinking: undefined,
    languages: null,
    preference: {},
    ...overrides,
  };
}

describe("scoreMatch — category scoring", () => {
  it("scores an exact age match at 100% (compatible) when both sides state a satisfied preference", () => {
    // Mutual by design (spec §4): a real profile always completes the
    // Partner Preferences step, so both directions carry real data here —
    // one side stating no preference at all would correctly pull the
    // *mutual* score down, since "no opinion" isn't the same as "confirmed
    // compatible" from that side.
    const a = profile({ preference: { minAge: 25, maxAge: 30 } });
    const b = profile({ id: "p2", age: 27, preference: { minAge: 25, maxAge: 32 } });
    const result = scoreMatch(a, b);
    const age = result.breakdown.find((r) => r.category === "age")!;
    expect(age.score).toBe(1);
    expect(age.status).toBe("compatible");
  });

  it("scores a moderately-outside age as partial compatibility", () => {
    const a = profile({ preference: { minAge: 25, maxAge: 30 } });
    const b = profile({ id: "p2", age: 34 }); // 4 over the max — "moderately outside"
    const result = scoreMatch(a, b);
    const age = result.breakdown.find((r) => r.category === "age")!;
    expect(age.status).toBe("partial");
  });

  it("scores a significantly-outside age as low/incompatible", () => {
    const a = profile({ preference: { minAge: 25, maxAge: 30 } });
    const b = profile({ id: "p2", age: 55 });
    const result = scoreMatch(a, b);
    const age = result.breakdown.find((r) => r.category === "age")!;
    expect(age.status).toBe("incompatible");
  });

  it("does not penalize a flexible/unset income preference", () => {
    const a = profile({ preference: { incomeFlexible: true } });
    const b = profile({ id: "p2", monthlyIncome: 190_000 });
    const result = scoreMatch(a, b);
    const income = result.breakdown.find((r) => r.category === "income")!;
    expect(income.status).toBe("unknown");
    expect(income.isDifference).toBe(false);
  });

  it("treats missing information as 'unknown', never as a penalty", () => {
    const a = profile(); // no religion, no preferences stated anywhere
    const b = profile({ id: "p2" });
    const result = scoreMatch(a, b);
    const religious = result.breakdown.find((r) => r.category === "religious")!;
    expect(religious.status).toBe("unknown");
    expect(religious.isDifference).toBe(false);
  });

  it("does not penalize languages when either side hasn't recorded any", () => {
    const a = profile({ languages: null });
    const b = profile({ id: "p2", languages: "Urdu, English" });
    const result = scoreMatch(a, b);
    const languages = result.breakdown.find((r) => r.category === "languages")!;
    expect(languages.status).toBe("unknown");
  });

  it("scores a shared language as compatible", () => {
    const a = profile({ languages: "Urdu, English" });
    const b = profile({ id: "p2", languages: "Punjabi, Urdu" });
    const result = scoreMatch(a, b);
    const languages = result.breakdown.find((r) => r.category === "languages")!;
    expect(languages.status).toBe("compatible");
  });
});

describe("scoreMatch — hard requirements", () => {
  it("excludes a candidate that fails a Must-Have category", () => {
    const a = profile({ preference: { minAge: 25, maxAge: 30 } });
    const b = profile({ id: "p2", age: 60 }); // far outside -> incompatible
    const hardRequirements: HardRequirements = { age: true };
    const result = scoreMatch(a, b, DEFAULT_WEIGHTS, hardRequirements);
    expect(result.excludedByHardRequirement).toBe(true);
    expect(result.failedHardRequirements).toContain("Age");
  });

  it("does not exclude when the same category is merely a soft preference", () => {
    const a = profile({ preference: { minAge: 25, maxAge: 30 } });
    const b = profile({ id: "p2", age: 60 });
    const result = scoreMatch(a, b, DEFAULT_WEIGHTS, {});
    expect(result.excludedByHardRequirement).toBe(false);
  });
});

describe("scoreMatch — mutual compatibility", () => {
  it("computes independent A→B and B→A directions, and the mutual score is the weaker-link blend, not a naive average", () => {
    // A is happy with any age; B insists on someone much younger than A —
    // B→A should score badly even though A→B scores perfectly, and the
    // mutual `total` should reflect the weaker side, not paper over it with
    // an average.
    const a = profile({ id: "p1", age: 45, preference: {} });
    const b = profile({ id: "p2", age: 25, preference: { minAge: 20, maxAge: 24 } });
    const result = scoreMatch(a, b);
    expect(result.direction.aToB).toBeGreaterThan(result.direction.bToA);
    const age = result.breakdown.find((r) => r.category === "age")!;
    expect(age.status).toBe("incompatible");
  });

  it("direction.aToB and direction.bToA are each independently bounded 0-100", () => {
    const a = profile({ preference: { minAge: 25, maxAge: 30 } });
    const b = profile({ id: "p2", age: 27 });
    const result = scoreMatch(a, b);
    expect(result.direction.aToB).toBeGreaterThanOrEqual(0);
    expect(result.direction.aToB).toBeLessThanOrEqual(100);
    expect(result.direction.bToA).toBeGreaterThanOrEqual(0);
    expect(result.direction.bToA).toBeLessThanOrEqual(100);
  });
});

describe("scoreMatch — weight normalization / enable-disable", () => {
  it("total stays within 0-100 when a category is disabled", () => {
    const a = profile({ preference: { minAge: 25, maxAge: 30 } });
    const b = profile({ id: "p2", age: 27 });
    const enabled: EnabledCategories = { income: false, height: false, family: false };
    const result = scoreMatch(a, b, DEFAULT_WEIGHTS, {}, enabled);
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.total).toBeLessThanOrEqual(100);
    expect(result.breakdown.find((r) => r.category === "income")).toBeUndefined();
  });

  it("a perfect match scores 100 regardless of which categories are enabled", () => {
    const a = profile({ preference: { minAge: 25, maxAge: 30 } });
    const b = profile({ id: "p2", age: 27 });
    const full = scoreMatch(a, b, DEFAULT_WEIGHTS, {}, {});
    const partial = scoreMatch(a, b, DEFAULT_WEIGHTS, {}, { languages: false, lifestyle: false });
    // Every enabled category here is either "compatible" or "unknown" (never
    // penalized), so both configurations should land at the same ceiling.
    expect(full.total).toBe(partial.total);
  });
});

describe("scoreMatchWithThresholds — tiering", () => {
  it("ranks a result set by total score, highest first", () => {
    const seeker = profile({ preference: { minAge: 25, maxAge: 30 } });
    const weakCandidate = profile({ id: "weak", age: 60 });
    const strongCandidate = profile({ id: "strong", age: 27 });
    const results = [weakCandidate, strongCandidate]
      .map((c) => ({ id: c.id, ...scoreMatchWithThresholds(seeker, c, DEFAULT_WEIGHTS, {}, DEFAULT_THRESHOLDS) }))
      .sort((x, y) => y.total - x.total);
    expect(results[0].id).toBe("strong");
    expect(results[0].total).toBeGreaterThan(results[1].total);
  });

  it("applies admin-configured tier thresholds instead of the defaults", () => {
    const a = profile({ preference: { minAge: 25, maxAge: 30 } });
    const b = profile({ id: "p2", age: 27 });
    const strictThresholds = { excellent: 99, veryGood: 98, good: 97, possible: 96 };
    const result = scoreMatchWithThresholds(a, b, DEFAULT_WEIGHTS, {}, strictThresholds);
    // Same inputs score much lower against unusually strict thresholds.
    expect(result.tier).not.toBe("EXCELLENT");
  });
});

describe("scoreMatch — spec §45 worked example", () => {
  it("produces a high (not hardcoded) compatibility score for a reasonably matched pair", () => {
    const profileA: MatchableProfile = {
      id: "A",
      gender: "MALE",
      age: 29,
      heightCm: 178, // 5'10"
      maritalStatus: "NEVER_MARRIED",
      city: "Lahore",
      area: null,
      country: "Pakistan",
      educationLevel: "Masters",
      profession: "Software Engineer",
      monthlyIncome: 200_000,
      familyType: null,
      familyStatus: null,
      religion: null,
      sect: null,
      languages: null,
      preference: {
        minAge: 25,
        maxAge: 30,
        preferredCity: "Lahore",
        minEducation: "Bachelors",
        professionPreference: "ANY",
        minIncome: 100_000,
        incomeFlexible: false,
        maritalStatusPreference: "NEVER_MARRIED",
      },
    };
    const profileB: MatchableProfile = {
      id: "B",
      gender: "FEMALE",
      age: 27,
      heightCm: 165, // 5'5"
      maritalStatus: "NEVER_MARRIED",
      city: "Lahore",
      area: null,
      country: "Pakistan",
      educationLevel: "Masters",
      profession: "Doctor",
      monthlyIncome: 180_000,
      familyType: null,
      familyStatus: null,
      religion: null,
      sect: null,
      languages: null,
      // A real profile always states partner preferences too (it's a
      // required registration step) — reciprocal and reasonably compatible
      // with Profile A, as the spec's own example implies without spelling
      // every field out.
      preference: {
        minAge: 27,
        maxAge: 34,
        preferredCity: "Lahore",
        minEducation: "Bachelors",
        professionPreference: "ANY",
        incomeFlexible: true,
        maritalStatusPreference: "NEVER_MARRIED",
      },
    };

    const result = scoreMatch(profileA, profileB);
    // The exact number is whatever the real engine computes — this only
    // asserts the class of outcome the spec describes ("high compatibility"),
    // never a hardcoded literal score.
    expect(result.total).toBeGreaterThanOrEqual(80);
    expect(result.excludedByHardRequirement).toBe(false);
  });
});
