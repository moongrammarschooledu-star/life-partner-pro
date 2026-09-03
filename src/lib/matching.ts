// Pure, dependency-free matching/scoring engine.
// Deliberately has no DB calls in here so it stays unit-testable and the
// weighting scheme can be tuned (or made admin-configurable) without
// touching any query code. See spec §14/§15.

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

// Converts the admin-configurable AppSettings row (spec §40, "Matching
// Settings — allow admin to adjust matching weights") into the shape
// scoreMatch expects. Callers should fetch AppSettings once per request and
// pass the result here rather than assuming DEFAULT_WEIGHTS.
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

export interface CategoryResult {
  category: MatchCategory;
  label: string;
  weight: number;
  score: number; // 0..1 fraction of the category weight achieved
  points: number; // weight * score
  reason: string;
  isDifference: boolean; // true if this should show under "Potential differences"
}

export interface MatchResult {
  total: number; // 0..100
  tier: "BEST_MATCH" | "VERY_GOOD_MATCH" | "GOOD_MATCH" | "POSSIBLE_MATCH" | "LOW_MATCH";
  tierLabel: string;
  breakdown: CategoryResult[];
  reasons: string[]; // "Why this match" — non-differences with score >= 0.7
  differences: string[]; // "Potential differences" — isDifference true
}

export interface MatchableProfile {
  id: string;
  gender: "MALE" | "FEMALE";
  age: number;
  heightCm: number;
  maritalStatus: string;
  city: string;
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

function scoreRange(value: number, min?: number | null, max?: number | null, tolerance = 0): number {
  if (min == null && max == null) return 0.8; // no stated preference — assume mild compatibility
  const lo = min ?? -Infinity;
  const hi = max ?? Infinity;
  if (value >= lo && value <= hi) return 1;
  const distance = value < lo ? lo - value : value - hi;
  if (tolerance <= 0) return 0.2;
  return clamp01(1 - distance / tolerance) * 0.6; // partial credit tapering to 0
}

function scoreAge(candidate: MatchableProfile, prefs: MatchableProfile["preference"]): CategoryResult {
  const score = scoreRange(candidate.age, prefs.minAge, prefs.maxAge, 5);
  const inRange = score === 1;
  return {
    category: "age",
    label: "Age",
    weight: 0,
    score,
    points: 0,
    reason: inRange
      ? `Age ${candidate.age} is within the preferred range`
      : `Age ${candidate.age} is outside the preferred range`,
    isDifference: !inRange,
  };
}

function scoreLocation(candidate: MatchableProfile, prefs: MatchableProfile["preference"]): CategoryResult {
  if (!prefs.preferredCity && !prefs.preferredCountry) {
    return {
      category: "location",
      label: "Location",
      weight: 0,
      score: 0.7,
      points: 0,
      reason: "No specific location preference stated",
      isDifference: false,
    };
  }
  if (prefs.preferredCity && candidate.city.toLowerCase() === prefs.preferredCity.toLowerCase()) {
    return {
      category: "location",
      label: "Location",
      weight: 0,
      score: 1,
      points: 0,
      reason: `Same city (${candidate.city})`,
      isDifference: false,
    };
  }
  if (prefs.preferredCountry && candidate.country.toLowerCase() === prefs.preferredCountry.toLowerCase()) {
    return {
      category: "location",
      label: "Location",
      weight: 0,
      score: 0.6,
      points: 0,
      reason: `Same country (${candidate.country}), different city`,
      isDifference: true,
    };
  }
  return {
    category: "location",
    label: "Location",
    weight: 0,
    score: 0.2,
    points: 0,
    reason: "Preferred city/country differs",
    isDifference: true,
  };
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

function scoreEducation(candidate: MatchableProfile, prefs: MatchableProfile["preference"]): CategoryResult {
  if (!prefs.minEducation) {
    return {
      category: "education",
      label: "Education",
      weight: 0,
      score: 0.75,
      points: 0,
      reason: "No specific education requirement stated",
      isDifference: false,
    };
  }
  const required = educationRank(prefs.minEducation);
  const actual = educationRank(candidate.educationLevel);
  const meets = actual >= required;
  return {
    category: "education",
    label: "Education",
    weight: 0,
    score: meets ? 1 : clamp01(0.5 - (required - actual) * 0.15),
    points: 0,
    reason: meets
      ? `Education (${candidate.educationLevel ?? "unspecified"}) meets the requirement`
      : `Education (${candidate.educationLevel ?? "unspecified"}) is below the preferred minimum (${prefs.minEducation})`,
    isDifference: !meets,
  };
}

function scoreProfession(candidate: MatchableProfile, prefs: MatchableProfile["preference"]): CategoryResult {
  const wanted = prefs.professionPreference?.trim();
  if (!wanted || wanted.toUpperCase() === "ANY") {
    return {
      category: "profession",
      label: "Profession",
      weight: 0,
      score: 0.75,
      points: 0,
      reason: "Open to any profession",
      isDifference: false,
    };
  }
  const match = candidate.profession?.toLowerCase().includes(wanted.toLowerCase());
  return {
    category: "profession",
    label: "Profession",
    weight: 0,
    score: match ? 1 : 0.4,
    points: 0,
    reason: match
      ? `Profession (${candidate.profession}) matches the preference`
      : `Profession (${candidate.profession ?? "unspecified"}) differs from the stated preference (${wanted})`,
    isDifference: !match,
  };
}

function scoreIncome(candidate: MatchableProfile, prefs: MatchableProfile["preference"]): CategoryResult {
  if (prefs.incomeFlexible || (prefs.minIncome == null && prefs.maxIncome == null)) {
    return {
      category: "income",
      label: "Income",
      weight: 0,
      score: 0.75,
      points: 0,
      reason: "Income preference marked as flexible",
      isDifference: false,
    };
  }
  if (candidate.monthlyIncome == null) {
    return {
      category: "income",
      label: "Income",
      weight: 0,
      score: 0.4,
      points: 0,
      reason: "Income not disclosed",
      isDifference: true,
    };
  }
  const score = scoreRange(candidate.monthlyIncome, prefs.minIncome, prefs.maxIncome, prefs.minIncome ? prefs.minIncome * 0.2 : 500);
  return {
    category: "income",
    label: "Income",
    weight: 0,
    score,
    points: 0,
    reason: score >= 1 ? "Within the preferred income range" : "Outside the preferred income range",
    isDifference: score < 1,
  };
}

function scoreMaritalStatus(candidate: MatchableProfile, prefs: MatchableProfile["preference"]): CategoryResult {
  const pref = prefs.maritalStatusPreference?.trim();
  if (!pref || pref.toUpperCase() === "ANY") {
    return {
      category: "maritalStatus",
      label: "Marital Status",
      weight: 0,
      score: 0.9,
      points: 0,
      reason: "Open to any marital status",
      isDifference: false,
    };
  }
  const allowed = pref.split(",").map((s) => s.trim().toUpperCase());
  const match = allowed.includes(candidate.maritalStatus.toUpperCase());
  return {
    category: "maritalStatus",
    label: "Marital Status",
    weight: 0,
    score: match ? 1 : 0.1,
    points: 0,
    reason: match
      ? "Marital status is compatible with the stated preference"
      : "Marital status does not match the stated preference",
    isDifference: !match,
  };
}

function scoreHeight(candidate: MatchableProfile, prefs: MatchableProfile["preference"]): CategoryResult {
  const score = scoreRange(candidate.heightCm, prefs.minHeightCm, prefs.maxHeightCm, 5);
  return {
    category: "height",
    label: "Height",
    weight: 0,
    score,
    points: 0,
    reason: score === 1 ? "Height is within the preferred range" : "Height is outside the preferred range",
    isDifference: score < 1,
  };
}

function scoreFamily(candidate: MatchableProfile, prefs: MatchableProfile["preference"]): CategoryResult {
  if (!prefs.familyTypePreference && !prefs.familyBackgroundPreference) {
    return {
      category: "family",
      label: "Family Background",
      weight: 0,
      score: 0.75,
      points: 0,
      reason: "No specific family requirement stated",
      isDifference: false,
    };
  }
  const typeOk = !prefs.familyTypePreference || prefs.familyTypePreference.toUpperCase() === "ANY" ||
    candidate.familyType?.toUpperCase() === prefs.familyTypePreference.toUpperCase();
  const bgOk = !prefs.familyBackgroundPreference || prefs.familyBackgroundPreference.toUpperCase() === "ANY" ||
    candidate.familyStatus?.toUpperCase() === prefs.familyBackgroundPreference.toUpperCase();
  const score = typeOk && bgOk ? 1 : typeOk || bgOk ? 0.6 : 0.3;
  return {
    category: "family",
    label: "Family Background",
    weight: 0,
    score,
    points: 0,
    reason: score === 1 ? "Family type and background match the preference" : "Family type/background partially matches the preference",
    isDifference: score < 1,
  };
}

function scoreReligious(candidate: MatchableProfile, other: MatchableProfile): CategoryResult {
  if (!candidate.religion && !other.religion) {
    return {
      category: "religious",
      label: "Religious Compatibility",
      weight: 0,
      score: 0.75,
      points: 0,
      reason: "Not specified by either profile",
      isDifference: false,
    };
  }
  const sameReligion = candidate.religion && other.religion && candidate.religion.toLowerCase() === other.religion.toLowerCase();
  const sameSect = candidate.sect && other.sect && candidate.sect.toLowerCase() === other.sect.toLowerCase();
  const score = sameReligion ? (sameSect || (!candidate.sect && !other.sect) ? 1 : 0.7) : 0.2;
  return {
    category: "religious",
    label: "Religious Compatibility",
    weight: 0,
    score,
    points: 0,
    reason: sameReligion ? "Same religious background" : "Different religious background",
    isDifference: score < 1,
  };
}

function scoreLifestyle(candidate: MatchableProfile, other: MatchableProfile): CategoryResult {
  const points: string[] = [];
  let matches = 0;
  let total = 0;
  total++;
  if (!!candidate.smoking === !!other.smoking) matches++;
  else points.push("smoking preference differs");
  total++;
  if (!!candidate.drinking === !!other.drinking) matches++;
  else points.push("drinking preference differs");
  const score = matches / total;
  return {
    category: "lifestyle",
    label: "Lifestyle",
    weight: 0,
    score,
    points: 0,
    reason: points.length ? `Lifestyle differences: ${points.join(", ")}` : "Lifestyle habits are compatible",
    isDifference: points.length > 0,
  };
}

const TIER_LABELS: Record<MatchResult["tier"], string> = {
  BEST_MATCH: "Best Match",
  VERY_GOOD_MATCH: "Very Good Match",
  GOOD_MATCH: "Good Match",
  POSSIBLE_MATCH: "Possible Match",
  LOW_MATCH: "Low Compatibility",
};

function tierFor(total: number): MatchResult["tier"] {
  if (total >= 90) return "BEST_MATCH";
  if (total >= 80) return "VERY_GOOD_MATCH";
  if (total >= 65) return "GOOD_MATCH";
  if (total >= 50) return "POSSIBLE_MATCH";
  return "LOW_MATCH";
}

/**
 * Scores `candidate` against `seeker`'s stated partner preference.
 * Symmetric fields (religion/lifestyle) look at both profiles directly;
 * asymmetric fields (age/location/education/profession/income/marital
 * status/height/family) are judged against `seeker.preference`.
 */
export function scoreMatch(
  seeker: MatchableProfile,
  candidate: MatchableProfile,
  weights: MatchWeights = DEFAULT_WEIGHTS
): MatchResult {
  const prefs = seeker.preference;
  const parts: CategoryResult[] = [
    scoreAge(candidate, prefs),
    scoreLocation(candidate, prefs),
    scoreEducation(candidate, prefs),
    scoreProfession(candidate, prefs),
    scoreIncome(candidate, prefs),
    scoreMaritalStatus(candidate, prefs),
    scoreHeight(candidate, prefs),
    scoreFamily(candidate, prefs),
    scoreReligious(candidate, seeker),
    scoreLifestyle(candidate, seeker),
  ].map((part) => {
    const weight = weights[part.category];
    return { ...part, weight, points: weight * part.score };
  });

  const total = Math.round(parts.reduce((sum, p) => sum + p.points, 0));
  const tier = tierFor(total);

  return {
    total,
    tier,
    tierLabel: TIER_LABELS[tier],
    breakdown: parts,
    reasons: parts.filter((p) => !p.isDifference && p.score >= 0.6).map((p) => `${p.label}: ${p.reason}`),
    differences: parts.filter((p) => p.isDifference).map((p) => `${p.label}: ${p.reason}`),
  };
}
