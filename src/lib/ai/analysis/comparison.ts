import type { AiPayload } from "@/lib/ai/types";
import type { AiProfileView } from "@/lib/ai/profile-view";
import { detectFindings } from "@/lib/ai/analysis/quality";
import { STANDARD_LIMITATIONS } from "@/lib/ai/analysis/summary";
import type { MutualAnalysis } from "@/lib/ai/analysis/mutual";

// Spec §8 — structured side-by-side comparison of 2–4 candidates.
// There is intentionally NO winner, score or ranking produced here. If the
// deterministic engine has scored specific pairs, those are passed in and
// shown in a separate, clearly labelled "System matching results" block.

const pretty = (s: string | null | undefined) => (s ? s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : "Not provided");

export interface ComparisonColumn {
  field: string;
  values: Record<string, string>; // keyed by the profile ref
}

function prefText(v: AiProfileView): string {
  const p = v.preference;
  const bits = [
    p.minAge || p.maxAge ? `age ${p.minAge ?? "any"}–${p.maxAge ?? "any"}` : null,
    p.preferredCity || p.preferredCountry ? `location ${[p.preferredCity, p.preferredCountry].filter(Boolean).join(", ")}` : null,
    p.minEducation ? `education ≥ ${p.minEducation}` : null,
    p.professionPreference && p.professionPreference !== "ANY" ? `profession ${p.professionPreference}` : null,
  ].filter(Boolean);
  return bits.length ? bits.join("; ") : "Not stated";
}

export function buildComparison(
  views: AiProfileView[],
  pairs: Array<{ a: string; b: string; analysis: MutualAnalysis }> = []
): AiPayload {
  const columns: ComparisonColumn[] = [];
  const col = (field: string, fn: (v: AiProfileView) => string) => {
    columns.push({ field, values: Object.fromEntries(views.map((v) => [v.ref, fn(v)])) });
  };

  col("Basic compatibility", (v) => `${v.age} y, ${pretty(v.gender)}, ${pretty(v.status)}`);
  col("Education", (v) => [v.educationLevel, v.degree].filter(Boolean).join(" · ") || "Not provided");
  col("Profession", (v) => [v.profession, pretty(v.employmentType)].filter((x) => x && x !== "Not provided").join(" · ") || "Not provided");
  col("Location", (v) => `${v.city}, ${v.country}`);
  col("Income", (v) => (v.hidden.income ? "Not available at your access level" : v.monthlyIncome != null ? String(v.monthlyIncome) : "Not provided"));
  col("Marital status", (v) => pretty(v.maritalStatus) + (v.hasChildren ? " (with children)" : ""));
  col("Height", (v) => (v.heightCm ? `${v.heightCm} cm` : "Not provided"));
  col("Family preferences", (v) => [pretty(v.familyType), pretty(v.familyStatus)].filter((x) => x !== "Not provided").join(" · ") || "Not provided");
  col("Religious preferences", (v) => [v.religion, v.sect, v.religiousPractice].filter(Boolean).join(" · ") || "Not provided");
  col("Lifestyle", (v) => [v.smoking ? "smoking" : null, v.drinking ? "drinking" : null, v.languages].filter(Boolean).join(" · ") || "Not provided");
  col("Partner requirements", prefText);
  col("Verification", (v) => pretty(v.verification?.status ?? "NOT_VERIFIED"));
  col("Profile completeness", (v) => `${v.completenessPercent}% (platform measure)`);
  col("Missing information", (v) => {
    const m = detectFindings(v).filter((f) => f.label === "MISSING").length;
    return m ? `${m} item(s)` : "None detected";
  });
  col("Review notes", (v) => {
    const f = detectFindings(v);
    const inc = f.filter((x) => x.label === "INCONSISTENT").length;
    const ver = f.filter((x) => x.label === "NEEDS_VERIFICATION").length;
    return [inc ? `${inc} potential inconsistency(ies) — admin review required` : null, ver ? `${ver} item(s) need verification` : null].filter(Boolean).join("; ") || "No open items detected";
  });

  const missing: string[] = [];
  const conflicts: string[] = [];
  for (const v of views) {
    for (const f of detectFindings(v)) {
      if (f.label === "MISSING") missing.push(`${v.ref}: ${f.message}`);
      if (f.label === "INCONSISTENT") conflicts.push(`${v.ref}: ${f.message}`);
    }
  }

  return {
    summary: `Side-by-side comparison of ${views.length} profiles across ${columns.length} areas. No overall ranking or winner is produced; differences are listed for admin review.`,
    evidence: [],
    alignedAreas: [],
    potentialConflicts: conflicts.slice(0, 40),
    missingInformation: missing.slice(0, 40),
    verificationQuestions: [],
    suggestedNextStep: "Review the differences with the relevant members; use the system matching results below only as a separate, deterministic reference.",
    limitations: [...STANDARD_LIMITATIONS, "This comparison lists documented differences; it does not rank or recommend a candidate."],
    sufficiency: views.every((v) => v.completenessPercent >= 80) ? "SUFFICIENT" : views.some((v) => v.completenessPercent < 50) ? "LIMITED" : "PARTIAL",
    data: {
      columns,
      refs: views.map((v) => ({ ref: v.ref, profileCode: v.profileCode })),
      systemMatchingResults: pairs.map((p) => ({ pair: `${p.a} × ${p.b}`, label: p.analysis.deterministic.label, total: p.analysis.deterministic.total, tier: p.analysis.deterministic.tierLabel, algorithmVersion: p.analysis.deterministic.algorithmVersion })),
      ranking: null,
    },
  };
}
