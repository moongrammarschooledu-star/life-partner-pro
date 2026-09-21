import {
  scoreMatch,
  ALGORITHM_VERSION,
  DEFAULT_WEIGHTS,
  type MatchableProfile,
  type MatchWeights,
  type HardRequirements,
  type EnabledCategories,
  type CompatibilityStatus,
  type MatchCategory,
} from "@/lib/matching";
import type { AiProfileView } from "@/lib/ai/profile-view";

// Spec §5/§6/§55 — the deterministic matcher stays the ONLY source of
// compatibility. This module never scores anything itself: it re-runs
// scoreMatch() and reads its category statuses, once with both sides' stated
// preferences and once for each single direction (by blanking the other side's
// preferences, which leaves exactly one direction with data). It then
// re-labels the deterministic result in neutral language.
//
// Missing information is NEVER treated as incompatibility (spec §6): a
// category with no usable data on either side is "INSUFFICIENT".

export type AiStatus = "COMPATIBLE" | "PARTIAL" | "CONFLICT" | "INSUFFICIENT";

export interface MatchConfigLite {
  weights: MatchWeights;
  hardRequirements: HardRequirements;
  enabled: EnabledCategories;
}

export const DEFAULT_MATCH_CONFIG: MatchConfigLite = { weights: DEFAULT_WEIGHTS, hardRequirements: {}, enabled: {} };

export function toAiStatus(s: CompatibilityStatus): AiStatus {
  switch (s) {
    case "compatible":
      return "COMPATIBLE";
    case "partial":
      return "PARTIAL";
    case "incompatible":
      return "CONFLICT";
    default:
      return "INSUFFICIENT";
  }
}

export const STATUS_WORDING: Record<AiStatus, string> = {
  COMPATIBLE: "Stated preferences align",
  PARTIAL: "Partially compatible — this area requires admin review",
  CONFLICT: "Potential requirement conflict",
  INSUFFICIENT: "Insufficient information",
};

export interface CategoryAnalysis {
  category: MatchCategory;
  label: string;
  combined: AiStatus;
  aToB: AiStatus;
  bToA: AiStatus;
  reason: string;
  restricted: boolean; // not visible at the requesting admin's access level
}

export interface MutualAnalysis {
  categories: CategoryAnalysis[];
  mutualCompatibility: AiStatus;
  requirementMatches: string[];
  sharedPreferences: string[];
  requirementConflicts: string[];
  flexibleAreas: string[];
  unknownInformation: string[];
  needsReview: string[];
  deterministic: {
    label: "System matching result";
    excludesRestrictedCategories: boolean;
    total: number;
    tierLabel: string;
    algorithmVersion: string;
    aToB: number;
    bToA: number;
  };
}

function withoutPreferences(p: MatchableProfile): MatchableProfile {
  return { ...p, preference: {} };
}

export interface AnalyzeOptions {
  config?: MatchConfigLite;
  // Categories the requesting admin may not see (e.g. income without
  // sensitive:income:view). They are reported as "not available", never as
  // missing or incompatible.
  restrictedCategories?: MatchCategory[];
}

function flexibleAreasOf(v: AiProfileView, who: string): string[] {
  const out: string[] = [];
  const p = v.preference;
  const any = (s?: string | null) => !s || s.toUpperCase() === "ANY";
  if (v.hasPreference) {
    if (any(p.professionPreference)) out.push(`${who}: profession — open to any`);
    if (any(p.maritalStatusPreference)) out.push(`${who}: marital status — open to any`);
    if (any(p.familyTypePreference)) out.push(`${who}: family type — flexible`);
    if (p.incomeFlexible) out.push(`${who}: income — flexible`);
  }
  return out;
}

export function analyzeMutual(
  a: { matchable: MatchableProfile; view: AiProfileView },
  b: { matchable: MatchableProfile; view: AiProfileView },
  opts: AnalyzeOptions = {}
): MutualAnalysis {
  const cfg = opts.config ?? DEFAULT_MATCH_CONFIG;
  const restricted = new Set(opts.restrictedCategories ?? []);
  // Categories the admin may not see are excluded from the engine run itself,
  // so neither their status nor their weight can leak through the totals.
  const enabled: EnabledCategories = { ...cfg.enabled };
  for (const r of restricted) enabled[r] = false;

  const full = scoreMatch(a.matchable, b.matchable, cfg.weights, cfg.hardRequirements, enabled);
  const onlyAtoB = scoreMatch(a.matchable, withoutPreferences(b.matchable), cfg.weights, cfg.hardRequirements, enabled);
  const onlyBtoA = scoreMatch(withoutPreferences(a.matchable), b.matchable, cfg.weights, cfg.hardRequirements, enabled);
  const dirA = new Map(onlyAtoB.breakdown.map((c) => [c.category, c]));
  const dirB = new Map(onlyBtoA.breakdown.map((c) => [c.category, c]));

  const categories: CategoryAnalysis[] = full.breakdown.map((c) => ({
    category: c.category,
    label: c.label,
    combined: toAiStatus(c.status),
    aToB: toAiStatus(dirA.get(c.category)?.status ?? "unknown"),
    bToA: toAiStatus(dirB.get(c.category)?.status ?? "unknown"),
    reason: c.reason,
    restricted: false,
  }));
  for (const r of restricted) {
    if (cfg.enabled[r] === false) continue;
    categories.push({ category: r, label: r === "income" ? "Income" : r, combined: "INSUFFICIENT", aToB: "INSUFFICIENT", bToA: "INSUFFICIENT", reason: "Not available at your access level", restricted: true });
  }

  const matches: string[] = [];
  const shared: string[] = [];
  const conflicts: string[] = [];
  const unknown: string[] = [];
  const review: string[] = [];
  for (const c of categories) {
    if (c.restricted) {
      unknown.push(`${c.label}: not available at your access level`);
      continue;
    }
    if (c.combined === "COMPATIBLE") matches.push(`${c.label}: ${c.reason}`);
    if (c.aToB !== "INSUFFICIENT" && c.bToA !== "INSUFFICIENT") shared.push(`${c.label}: both profiles state a preference`);
    if (c.combined === "CONFLICT") conflicts.push(`${c.label}: ${c.reason}`);
    else if (c.combined === "PARTIAL") review.push(`${c.label}: ${c.reason}`);
    if (c.combined === "INSUFFICIENT") unknown.push(`${c.label}: insufficient information`);
  }

  const known = categories.filter((c) => c.combined !== "INSUFFICIENT");
  let mutual: AiStatus;
  if (known.length === 0) mutual = "INSUFFICIENT";
  else if (categories.some((c) => c.combined === "CONFLICT")) mutual = "CONFLICT";
  else if (categories.some((c) => c.combined === "PARTIAL")) mutual = "PARTIAL";
  else mutual = "COMPATIBLE";

  return {
    categories,
    mutualCompatibility: mutual,
    requirementMatches: matches,
    sharedPreferences: shared,
    requirementConflicts: conflicts,
    flexibleAreas: [...flexibleAreasOf(a.view, a.view.ref), ...flexibleAreasOf(b.view, b.view.ref)],
    unknownInformation: unknown,
    needsReview: review,
    deterministic: {
      label: "System matching result",
      excludesRestrictedCategories: restricted.size > 0,
      total: full.total,
      tierLabel: full.tierLabel,
      algorithmVersion: ALGORITHM_VERSION,
      aToB: full.direction.aToB,
      bToA: full.direction.bToA,
    },
  };
}
