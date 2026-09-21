import type { AiPayload, Evidence } from "@/lib/ai/types";
import type { AiProfileView } from "@/lib/ai/profile-view";
import type { MutualAnalysis, AiStatus } from "@/lib/ai/analysis/mutual";
import { STATUS_WORDING } from "@/lib/ai/analysis/mutual";
import { detectFindings } from "@/lib/ai/analysis/quality";
import { STANDARD_LIMITATIONS } from "@/lib/ai/analysis/summary";
import { NEUTRAL_PHRASES } from "@/lib/ai/safety";
import type { Sufficiency } from "@/lib/ai/types";

// Spec §5/§6/§7/§9 — match explanation and review assistant. The compatibility
// score shown is the deterministic engine's own ("System matching result");
// nothing here computes or alters a score. Wording is neutral (§7).

function sufficiencyOfMutual(m: MutualAnalysis): Sufficiency {
  const total = m.categories.length || 1;
  const unknown = m.categories.filter((c) => c.combined === "INSUFFICIENT").length;
  const ratio = unknown / total;
  if (ratio <= 0.25) return "SUFFICIENT";
  if (ratio <= 0.6) return "PARTIAL";
  return "LIMITED";
}

const headlineFor: Record<AiStatus, string> = {
  COMPATIBLE: `${NEUTRAL_PHRASES.potential}: ${NEUTRAL_PHRASES.aligned.toLowerCase()}.`,
  PARTIAL: `${NEUTRAL_PHRASES.potential} in several areas; ${NEUTRAL_PHRASES.review.toLowerCase()} in others.`,
  CONFLICT: `${NEUTRAL_PHRASES.conflict} identified; ${NEUTRAL_PHRASES.review.toLowerCase()}.`,
  INSUFFICIENT: `${NEUTRAL_PHRASES.insufficient} to describe compatibility.`,
};

export interface MatchReview {
  aligns: string[];
  needsReview: string[];
  questionsForAdmin: string[];
  suggestedNextStep: string;
}

export function buildMatchReview(a: AiProfileView, b: AiProfileView, m: MutualAnalysis): MatchReview {
  const fa = detectFindings(a);
  const fb = detectFindings(b);
  const aligns = [...m.requirementMatches];
  const needsReview = [...m.requirementConflicts, ...m.needsReview, ...m.unknownInformation];

  const questions: string[] = [];
  for (const c of m.categories) {
    if (c.combined === "CONFLICT") questions.push(`Both members stated preferences on ${c.label.toLowerCase()} that do not fully align — is either side flexible?`);
    if (c.combined === "INSUFFICIENT" && !c.restricted) questions.push(`Can the missing ${c.label.toLowerCase()} information be obtained from the members?`);
  }
  for (const [who, list] of [[a.ref, fa], [b.ref, fb]] as const) {
    if (list.some((f) => f.label === "NEEDS_VERIFICATION" && f.area === "Verification")) questions.push(`${who}: is verification complete before a proposal is prepared?`);
  }

  let next: string;
  const bothVerified = a.verification?.status === "VERIFIED" && b.verification?.status === "VERIFIED";
  if (m.mutualCompatibility === "INSUFFICIENT") next = "Request more information from the members before reviewing further.";
  else if (!bothVerified) next = "Verify the outstanding profile information first.";
  else if (m.requirementConflicts.length) next = "Review the partner requirements with both members, and confirm consent, before continuing.";
  else next = "Continue proposal review (member consent for sharing details is still required).";

  return { aligns, needsReview, questionsForAdmin: [...new Set(questions)].slice(0, 12), suggestedNextStep: next };
}

export function buildMatchExplanation(a: AiProfileView, b: AiProfileView, m: MutualAnalysis): AiPayload {
  const review = buildMatchReview(a, b, m);
  const evidence: Evidence[] = m.categories.map((c) => ({
    label: c.label,
    value: `${STATUS_WORDING[c.combined]}${c.restricted ? "" : ` (${a.ref}→${b.ref}: ${STATUS_WORDING[c.aToB]}; ${b.ref}→${a.ref}: ${STATUS_WORDING[c.bToA]})`}`.slice(0, 300),
    source: "AI_OBSERVATION",
  }));
  evidence.push({
    label: `${m.deterministic.label} (${m.deterministic.algorithmVersion})`,
    value: `${m.deterministic.total}/100 — ${m.deterministic.tierLabel}${m.deterministic.excludesRestrictedCategories ? " (excludes categories not available at your access level)" : ""}. Calculated by the deterministic matching engine, not by AI.`,
    source: "VERIFIED",
  });

  return {
    summary: headlineFor[m.mutualCompatibility],
    evidence,
    alignedAreas: review.aligns,
    potentialConflicts: [...m.requirementConflicts, ...m.needsReview],
    missingInformation: m.unknownInformation,
    verificationQuestions: review.questionsForAdmin,
    suggestedNextStep: review.suggestedNextStep,
    limitations: [
      ...STANDARD_LIMITATIONS,
      "The compatibility score comes only from the deterministic matching engine; this text explains it and cannot change it.",
      "Missing information is described as 'insufficient information', not as incompatibility.",
    ],
    sufficiency: sufficiencyOfMutual(m),
    data: {
      mutualCompatibility: m.mutualCompatibility,
      categories: m.categories.map((c) => ({ category: c.category, label: c.label, status: c.combined, aToB: c.aToB, bToA: c.bToA, restricted: c.restricted })),
      sharedPreferences: m.sharedPreferences,
      requirementMatches: m.requirementMatches,
      requirementConflicts: m.requirementConflicts,
      flexibleAreas: m.flexibleAreas,
      unknownInformation: m.unknownInformation,
      review,
      systemMatchingResult: m.deterministic,
    },
  };
}
