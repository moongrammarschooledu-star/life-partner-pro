// Pure, dependency-free matching/scoring engine. No DB calls in here so it
// stays unit-testable and the weighting/threshold/hard-requirement scheme
// can be tuned (all admin-configurable — see AppSettings) without touching
// any query code.
//
// Core rule (spec §15): compatibility is MUTUAL. For every preference-based
// category we score BOTH directions — does the candidate meet the seeker's
// stated preference, AND does the seeker meet the candidate's — then take
// the weaker of the two. A profile that looks perfect from one side but is
// explicitly outside what the other side is looking for is not a good
// match, and the weaker direction is what should show up in the score.
//
// This produces a "Compatibility Suggestion" for admin review, never a
// guarantee (spec §49) — the UI must not present these as certainties.

export type MatchCategory =
  | "age"
  | "location"
  | "education"
  | "profession"
  | "income"
  | "maritalStatus"
  | "height"
  | "family"
  | "religious"
  | "lifestyle";

export type CompatibilityStatus = "compatible" | "partial" | "incompatible" | "unknown";

export interface MatchWeights {
  age: number;
  location: number;
  education: number;
  profession: number;
  income: number;
  maritalStatus: number;
  height: number;
  family: number;
  religious: number;
  lifestyle: number;
}

export type HardRequirements = Partial<Record<MatchCategory, boolean>>;

export interface MatchThresholds {
  excellent: number;
  veryGood: number;
  good: number;
  possible: number;
}

export const DEFAULT_WEIGHTS: MatchWeights = {
  age: 15,
  location: 15,
  education: 10,
  profession: 10,
  income: 10,
  maritalStatus: 10,
  height: 5,
  family: 10,
  religious: 10,
  lifestyle: 5,
};

export const DEFAULT_THRESHOLDS: MatchThresholds = {
  excellent: 90,
  veryGood: 80,
  good: 65,
  possible: 50,
};

export function weightsFromSettings(settings: {
  weightAge: number;
  weightLocation: number;
  weightEducation: number;
  weightProfession: number;
  weightIncome: number;
  weightMaritalStatus: number;
  weightHeight: number;
  weightFamily: number;
  weightReligious: number;
  weightLifestyle: number;
}): MatchWeights {
  return {
    age: settings.weightAge,
    location: settings.weightLocation,
    education: settings.weightEducation,
    profession: settings.weightProfession,
    income: settings.weightIncome,
    maritalStatus: settings.weightMaritalStatus,
    height: settings.weightHeight,
    family: settings.weightFamily,
    religious: settings.weightReligious,
    lifestyle: settings.weightLifestyle,
  };
}

export function hardRequirementsFromSettings(settings: {
  hardRequirementAge: boolean;
  hardRequirementLocation: boolean;
  hardRequirementEducation: boolean;
  hardRequirementProfession: boolean;
  hardRequirementIncome: boolean;
  hardRequirementMaritalStatus: boolean;
  hardRequirementHeight: boolean;
  hardRequirementFamily: boolean;
  hardRequirementReligious: boolean;
  hardRequirementLifestyle: boolean;
}): HardRequirements {
  return {
    age: settings.hardRequirementAge,
    location: settings.hardRequirementLocation,
    education: settings.hardRequirementEducation,
    profession: settings.hardRequirementProfession,
    income: settings.hardRequirementIncome,
    maritalStatus: settings.hardRequirementMaritalStatus,
    height: settings.hardRequirementHeight,
    family: settings.hardRequirementFamily,
    religious: settings.hardRequirementReligious,
    lifestyle: settings.hardRequirementLifestyle,
  };
}

export function thresholdsFromSettings(settings: {
  thresholdExcellent: number;
  thresholdVeryGood: number;
  thresholdGood: number;
  thresholdPossible: number;
}): MatchThresholds {
  return {
    excellent: settings.thresholdExcellent,
    veryGood: settings.thresholdVeryGood,
    good: settings.thresholdGood,
    possible: settings.thresholdPossible,
  };
}

export interface CategoryResult {
  category: MatchCategory;
  label: string;
  weight: number;
  score: number; // 0..1 fraction of the category weight achieved (mutual — the weaker of both directions)
  points: number; // weight * score
  status: CompatibilityStatus;
  reason: string;
  isDifference: boolean; // true if this should show under "Potential differences"
  hardRequirementFailed: boolean;
}

export interface MatchResult {
  total: number; // 0..100
  tier: "EXCELLENT" | "VERY_GOOD" | "GOOD" | "POSSIBLE" | "LOW";
  tierLabel: string;
  breakdown: CategoryResult[];
  reasons: string[]; // "Why this match" — non-differences with score >= 0.6
  differences: string[]; // "Potential differences" — isDifference true
  excludedByHardRequirement: boolean; // caller should drop this candidate from results if true
  failedHardRequirements: string[];
}

export interface MatchableProfile {
  id: string;
  gender: "MALE" | "FEMALE";
  age: number;
  heightCm: number;
  maritalStatus: string;
  city: string;
  area?: string | null;
  country: string;
  educationLevel?: string | null;
  profession?: string | null;
  monthlyIncome?: number | null;
  familyType?: string | null;
  familyStatus?: string | null;
  religion?: string | null;
  sect?: string | null;
  smoking?: boolean;
  drinking?: boolean;
  preference: {
    minAge?: number | null;
    maxAge?: number | null;
    preferredCountry?: string | null;
    preferredCity?: string | null;
    preferredArea?: string | null;
    minEducation?: string | null;
    professionPreference?: string | null;
    minIncome?: number | null;
    maxIncome?: number | null;
    incomeFlexible?: boolean;
    maritalStatusPreference?: string | null; // comma separated or "ANY"
    minHeightCm?: number | null;
    maxHeightCm?: number | null;
    familyTypePreference?: string | null;
    familyBackgroundPreference?: string | null;
  };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function statusFor(score: number, hasData: boolean): CompatibilityStatus {
  if (!hasData) return "unknown";
  if (score >= 0.8) return "compatible";
  if (score >= 0.4) return "partial";
  return "incompatible";
}

// ---------- Directional scorers ----------
// Each returns { score, hasData } for ONE direction (a preference applied to
// a candidate's actual attribute). scoreMatch() below calls these twice —
// once per direction — and combines with Math.min for the mutual result.

function scoreAgeDirection(candidateAge: number, minAge?: number | null, maxAge?: number | null): { score: number; hasData: boolean } {
  if (minAge == null && maxAge == null) return { score: 0.75, hasData: false };
  const lo = minAge ?? 18;
  const hi = maxAge ?? 80;
  if (candidateAge >= lo && candidateAge <= hi) return { score: 1, hasData: true };
  const distance = candidateAge < lo ? lo - candidateAge : candidateAge - hi;
  if (distance <= 2) return { score: 0.8, hasData: true }; // "close to range"
  if (distance <= 5) return { score: 0.5, hasData: true }; // "moderately outside"
  return { score: 0.1, hasData: true }; // "significantly outside"
}

function scoreLocationDirection(
  candidateCity: string,
  candidateArea: string | null | undefined,
  candidateCountry: string,
  preferredCity?: string | null,
  preferredArea?: string | null,
  preferredCountry?: string | null
): { score: number; hasData: boolean } {
  if (!preferredCity && !preferredCountry && !preferredArea) return { score: 0.7, hasData: false };
  if (preferredArea && candidateArea && candidateArea.toLowerCase() === preferredArea.toLowerCase()) {
    return { score: 1, hasData: true }; // same area
  }
  if (preferredCity && candidateCity.toLowerCase() === preferredCity.toLowerCase()) {
    return { score: 0.9, hasData: true }; // same city
  }
  if (preferredCountry && candidateCountry.toLowerCase() === preferredCountry.toLowerCase()) {
    return { score: 0.7, hasData: true }; // same country, different city (region tier)
  }
  return { score: 0.2, hasData: true }; // different country
}

const EDUCATION_RANK: Record<string, number> = {
  matric: 1,
  intermediate: 2,
  bachelors: 3,
  masters: 4,
  mphil: 5,
  phd: 6,
};

function educationRank(level?: string | null): number {
  if (!level) return 0;
  const key = level.toLowerCase().replace(/[^a-z]/g, "");
  return EDUCATION_RANK[key] ?? 3;
}

function scoreEducationDirection(candidateLevel: string | null | undefined, minEducation?: string | null): { score: number; hasData: boolean } {
  if (!minEducation) return { score: 0.75, hasData: false };
  const required = educationRank(minEducation);
  const actual = educationRank(candidateLevel);
  if (actual === required) return { score: 1, hasData: true }; // exact
  if (actual > required) return { score: 0.8, hasData: true }; // higher — related/acceptable
  const gap = required - actual;
  if (gap === 1) return { score: 0.6, hasData: true }; // acceptable lower level
  return { score: 0.25, hasData: true }; // not compatible
}

function scoreProfessionDirection(candidateProfession: string | null | undefined, wanted?: string | null): { score: number; hasData: boolean } {
  const pref = wanted?.trim();
  if (!pref || pref.toUpperCase() === "ANY") return { score: 1, hasData: false }; // "any profession" = 100% per spec §19
  if (!candidateProfession) return { score: 0.4, hasData: true };
  const match = candidateProfession.toLowerCase().includes(pref.toLowerCase());
  return { score: match ? 1 : 0.4, hasData: true };
}

function scoreIncomeDirection(
  candidateIncome: number | null | undefined,
  minIncome?: number | null,
  maxIncome?: number | null,
  flexible?: boolean
): { score: number; hasData: boolean } {
  if (flexible || (minIncome == null && maxIncome == null)) return { score: 0.75, hasData: false };
  if (candidateIncome == null) return { score: 0.4, hasData: true };
  const lo = minIncome ?? 0;
  const hi = maxIncome ?? Infinity;
  if (candidateIncome >= lo && candidateIncome <= hi) return { score: 1, hasData: true };
  const reference = lo || hi || 1000;
  const distanceRatio = (candidateIncome < lo ? lo - candidateIncome : candidateIncome - hi) / reference;
  if (distanceRatio <= 0.15) return { score: 0.75, hasData: true }; // slightly outside
  if (distanceRatio <= 0.4) return { score: 0.5, hasData: true }; // moderately outside
  return { score: 0.2, hasData: true }; // far outside
}

function scoreMaritalStatusDirection(candidateStatus: string, pref?: string | null): { score: number; hasData: boolean } {
  const value = pref?.trim();
  if (!value || value.toUpperCase() === "ANY") return { score: 0.9, hasData: false };
  const allowed = value.split(",").map((s) => s.trim().toUpperCase());
  if (allowed.includes(candidateStatus.toUpperCase())) return { score: 1, hasData: true };
  // Widowed/divorced are treated as a softer, partially-acceptable alternative
  // to each other rather than a hard clash with "never married".
  const softAlternatives = new Set(["DIVORCED", "WIDOWED"]);
  if (softAlternatives.has(candidateStatus.toUpperCase()) && allowed.some((a) => softAlternatives.has(a))) {
    return { score: 0.6, hasData: true };
  }
  return { score: 0, hasData: true };
}

function scoreHeightDirection(candidateHeight: number, minHeight?: number | null, maxHeight?: number | null): { score: number; hasData: boolean } {
  if (minHeight == null && maxHeight == null) return { score: 0.75, hasData: false };
  const lo = minHeight ?? 100;
  const hi = maxHeight ?? 230;
  if (candidateHeight >= lo && candidateHeight <= hi) return { score: 1, hasData: true };
  const distance = candidateHeight < lo ? lo - candidateHeight : candidateHeight - hi;
  if (distance <= 3) return { score: 0.8, hasData: true };
  if (distance <= 8) return { score: 0.5, hasData: true };
  return { score: 0.15, hasData: true };
}

function scoreFamilyDirection(
  candidateFamilyType: string | null | undefined,
  candidateFamilyStatus: string | null | undefined,
  familyTypePref?: string | null,
  familyBackgroundPref?: string | null
): { score: number; hasData: boolean } {
  if ((!familyTypePref || familyTypePref.toUpperCase() === "ANY") && (!familyBackgroundPref || familyBackgroundPref.toUpperCase() === "ANY")) {
    return { score: 0.75, hasData: false };
  }
  const typeOk = !familyTypePref || familyTypePref.toUpperCase() === "ANY" || candidateFamilyType?.toUpperCase() === familyTypePref.toUpperCase();
  const bgOk =
    !familyBackgroundPref ||
    familyBackgroundPref.toUpperCase() === "ANY" ||
    candidateFamilyStatus?.toUpperCase() === familyBackgroundPref.toUpperCase();
  if (typeOk && bgOk) return { score: 1, hasData: true };
  if (typeOk || bgOk) return { score: 0.6, hasData: true };
  return { score: 0.3, hasData: true };
}

// ---------- Symmetric scorers (compare both profiles' actual attributes
// directly rather than a stated preference — spec §24/§25) ----------

function scoreReligious(a: MatchableProfile, b: MatchableProfile): { score: number; hasData: boolean } {
  if (!a.religion && !b.religion) return { score: 0.75, hasData: false };
  if (!a.religion || !b.religion) return { score: 0.6, hasData: false }; // one side didn't say — don't penalize as incompatible
  const sameReligion = a.religion.toLowerCase() === b.religion.toLowerCase();
  if (!sameReligion) return { score: 0.15, hasData: true };
  if (!a.sect || !b.sect) return { score: 1, hasData: true };
  return { score: a.sect.toLowerCase() === b.sect.toLowerCase() ? 1 : 0.7, hasData: true };
}

function scoreLifestyle(a: MatchableProfile, b: MatchableProfile): { score: number; hasData: boolean; note: string } {
  const aKnown = a.smoking != null && a.drinking != null;
  const bKnown = b.smoking != null && b.drinking != null;
  if (!aKnown && !bKnown) return { score: 0.75, hasData: false, note: "Lifestyle habits not specified by either profile" };
  let matches = 0;
  let total = 0;
  const diffs: string[] = [];
  if (a.smoking != null && b.smoking != null) {
    total++;
    if (a.smoking === b.smoking) matches++;
    else diffs.push("smoking");
  }
  if (a.drinking != null && b.drinking != null) {
    total++;
    if (a.drinking === b.drinking) matches++;
    else diffs.push("drinking");
  }
  if (total === 0) return { score: 0.75, hasData: false, note: "Lifestyle habits not fully specified" };
  return {
    score: matches / total,
    hasData: true,
    note: diffs.length ? `Differs on: ${diffs.join(", ")}` : "Lifestyle habits are compatible",
  };
}

const TIER_LABELS: Record<MatchResult["tier"], string> = {
  EXCELLENT: "Excellent Match",
  VERY_GOOD: "Very Good Match",
  GOOD: "Good Match",
  POSSIBLE: "Possible Match",
  LOW: "Low Compatibility",
};

function tierFor(total: number, thresholds: MatchThresholds): MatchResult["tier"] {
  if (total >= thresholds.excellent) return "EXCELLENT";
  if (total >= thresholds.veryGood) return "VERY_GOOD";
  if (total >= thresholds.good) return "GOOD";
  if (total >= thresholds.possible) return "POSSIBLE";
  return "LOW";
}

/**
 * Scores mutual compatibility between two profiles. For every
 * preference-driven category, both directions are evaluated — A's stated
 * preference against B's actual attributes, and B's against A's — and the
 * WEAKER of the two is used, because a match only works if both sides would
 * actually be happy with it (spec §15). Symmetric categories (religion,
 * lifestyle) compare both profiles' actual attributes directly.
 *
 * This is a "Compatibility Suggestion" for admin review, not a guarantee of
 * a successful match (spec §49) — callers must present it as such.
 */
export function scoreMatch(
  a: MatchableProfile,
  b: MatchableProfile,
  weights: MatchWeights = DEFAULT_WEIGHTS,
  hardRequirements: HardRequirements = {}
): MatchResult {
  const aToB = a.preference;
  const bToA = b.preference;

  function mutual(
    category: MatchCategory,
    label: string,
    dirAtoB: { score: number; hasData: boolean },
    dirBtoA: { score: number; hasData: boolean },
    reasonForStatus: (status: CompatibilityStatus, weaker: "a" | "b") => string
  ): CategoryResult {
    const weaker = dirAtoB.score <= dirBtoA.score ? "a" : "b";
    const combinedScore = Math.min(dirAtoB.score, dirBtoA.score);
    const hasData = dirAtoB.hasData || dirBtoA.hasData;
    const status = statusFor(combinedScore, hasData);
    const weight = weights[category];
    const isHard = !!hardRequirements[category];
    const hardFailed = isHard && status === "incompatible";
    return {
      category,
      label,
      weight,
      score: combinedScore,
      points: weight * combinedScore,
      status,
      reason: reasonForStatus(status, weaker),
      isDifference: status === "incompatible" || status === "partial",
      hardRequirementFailed: hardFailed,
    };
  }

  const parts: CategoryResult[] = [];

  parts.push(
    mutual(
      "age",
      "Age",
      scoreAgeDirection(b.age, aToB.minAge, aToB.maxAge),
      scoreAgeDirection(a.age, bToA.minAge, bToA.maxAge),
      (status) =>
        status === "unknown"
          ? "No age preference stated"
          : status === "compatible"
            ? `Both ages (${a.age}, ${b.age}) fall within each other's preferred range`
            : `Age preference conflict — at least one side's range excludes the other (${a.age} vs ${b.age})`
    )
  );

  parts.push(
    mutual(
      "location",
      "Location",
      scoreLocationDirection(b.city, b.area, b.country, aToB.preferredCity, aToB.preferredArea, aToB.preferredCountry),
      scoreLocationDirection(a.city, a.area, a.country, bToA.preferredCity, bToA.preferredArea, bToA.preferredCountry),
      (status) =>
        status === "unknown"
          ? "No location preference stated"
          : status === "compatible"
            ? `Location works for both sides (${a.city} / ${b.city})`
            : `Preferred location differs from at least one side's actual city (${a.city} vs ${b.city})`
    )
  );

  parts.push(
    mutual(
      "education",
      "Education",
      scoreEducationDirection(b.educationLevel, aToB.minEducation),
      scoreEducationDirection(a.educationLevel, bToA.minEducation),
      (status) =>
        status === "unknown"
          ? "No education requirement stated"
          : status === "compatible"
            ? "Education levels meet both sides' requirements"
            : "Education level falls short of at least one side's stated requirement"
    )
  );

  parts.push(
    mutual(
      "profession",
      "Profession",
      scoreProfessionDirection(b.profession, aToB.professionPreference),
      scoreProfessionDirection(a.profession, bToA.professionPreference),
      (status) =>
        status === "unknown"
          ? "Open to any profession on at least one side"
          : status === "compatible"
            ? "Profession matches both sides' preference"
            : "Profession differs from at least one side's stated preference"
    )
  );

  parts.push(
    mutual(
      "income",
      "Income",
      scoreIncomeDirection(b.monthlyIncome, aToB.minIncome, aToB.maxIncome, aToB.incomeFlexible),
      scoreIncomeDirection(a.monthlyIncome, bToA.minIncome, bToA.maxIncome, bToA.incomeFlexible),
      (status) =>
        status === "unknown"
          ? "Income preference marked as flexible or not stated"
          : status === "compatible"
            ? "Income is within both sides' preferred range"
            : "Income falls outside at least one side's preferred range"
    )
  );

  parts.push(
    mutual(
      "maritalStatus",
      "Marital Status",
      scoreMaritalStatusDirection(b.maritalStatus, aToB.maritalStatusPreference),
      scoreMaritalStatusDirection(a.maritalStatus, bToA.maritalStatusPreference),
      (status) =>
        status === "unknown"
          ? "Open to any marital status on at least one side"
          : status === "compatible"
            ? "Marital status is mutually acceptable"
            : "Marital status does not meet at least one side's stated preference"
    )
  );

  parts.push(
    mutual(
      "height",
      "Height",
      scoreHeightDirection(b.heightCm, aToB.minHeightCm, aToB.maxHeightCm),
      scoreHeightDirection(a.heightCm, bToA.minHeightCm, bToA.maxHeightCm),
      (status) =>
        status === "unknown"
          ? "No height preference stated"
          : status === "compatible"
            ? "Height is within both sides' preferred range"
            : "Height falls outside at least one side's preferred range"
    )
  );

  parts.push(
    mutual(
      "family",
      "Family Background",
      scoreFamilyDirection(b.familyType, b.familyStatus, aToB.familyTypePreference, aToB.familyBackgroundPreference),
      scoreFamilyDirection(a.familyType, a.familyStatus, bToA.familyTypePreference, bToA.familyBackgroundPreference),
      (status) =>
        status === "unknown"
          ? "No specific family requirement stated"
          : status === "compatible"
            ? "Family type and background match both sides' expectations"
            : "Family type or background partially or fully differs from a stated preference"
    )
  );

  const religious = scoreReligious(a, b);
  const religiousWeight = weights.religious;
  const religiousStatus = statusFor(religious.score, religious.hasData);
  parts.push({
    category: "religious",
    label: "Religious Compatibility",
    weight: religiousWeight,
    score: religious.score,
    points: religiousWeight * religious.score,
    status: religiousStatus,
    reason:
      religiousStatus === "unknown"
        ? "Religious background not specified by one or both profiles"
        : religiousStatus === "compatible"
          ? "Same religious background"
          : "Different religious background",
    isDifference: religiousStatus === "incompatible" || religiousStatus === "partial",
    hardRequirementFailed: !!hardRequirements.religious && religiousStatus === "incompatible",
  });

  const lifestyle = scoreLifestyle(a, b);
  const lifestyleWeight = weights.lifestyle;
  const lifestyleStatus = statusFor(lifestyle.score, lifestyle.hasData);
  parts.push({
    category: "lifestyle",
    label: "Lifestyle",
    weight: lifestyleWeight,
    score: lifestyle.score,
    points: lifestyleWeight * lifestyle.score,
    status: lifestyleStatus,
    reason: lifestyle.note,
    isDifference: lifestyleStatus === "incompatible" || lifestyleStatus === "partial",
    hardRequirementFailed: !!hardRequirements.lifestyle && lifestyleStatus === "incompatible",
  });

  const total = Math.round(clamp01(parts.reduce((sum, p) => sum + p.points, 0) / 100) * 100);
  const thresholds = DEFAULT_THRESHOLDS;
  const tier = tierFor(total, thresholds);

  const failedHard = parts.filter((p) => p.hardRequirementFailed);

  return {
    total,
    tier,
    tierLabel: TIER_LABELS[tier],
    breakdown: parts,
    reasons: parts.filter((p) => p.status === "compatible").map((p) => `${p.label}: ${p.reason}`),
    differences: parts.filter((p) => p.isDifference).map((p) => `${p.label}: ${p.reason}`),
    excludedByHardRequirement: failedHard.length > 0,
    failedHardRequirements: failedHard.map((p) => p.label),
  };
}

/** Same as scoreMatch but resolves tier against admin-configured thresholds. */
export function scoreMatchWithThresholds(
  a: MatchableProfile,
  b: MatchableProfile,
  weights: MatchWeights,
  hardRequirements: HardRequirements,
  thresholds: MatchThresholds
): MatchResult {
  const result = scoreMatch(a, b, weights, hardRequirements);
  const tier = tierFor(result.total, thresholds);
  return { ...result, tier, tierLabel: TIER_LABELS[tier] };
}
