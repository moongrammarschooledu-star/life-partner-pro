import type { AiPayload, Evidence, InfoSource } from "@/lib/ai/types";
import type { AiProfileView } from "@/lib/ai/profile-view";
import { detectFindings, sufficiencyOf } from "@/lib/ai/analysis/quality";
import { NEUTRAL_PHRASES } from "@/lib/ai/safety";

// Spec §4 — structured profile summary. Every line is labelled:
//   VERIFIED       verified by the platform (verification records only)
//   USER_PROVIDED  submitted by the member, not independently verified
//   AI_OBSERVATION an interpretation that must not be treated as verified fact

const pretty = (s: string | null | undefined) => (s ? s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : null);

function line(out: Evidence[], label: string, value: string | number | null | undefined, source: InfoSource = "USER_PROVIDED") {
  if (value === null || value === undefined || value === "") return;
  out.push({ label, value: String(value).slice(0, 300), source });
}

export const STANDARD_LIMITATIONS = [
  "This summary is generated from the information in the database and is not a verified statement of fact.",
  "It does not assess health, personality, appearance or legal matters, and does not predict relationship outcomes.",
  "An authorised admin must review it before any decision is taken.",
];

export function buildProfileSummary(v: AiProfileView): AiPayload {
  const findings = detectFindings(v);
  const evidence: Evidence[] = [];

  // Verified — only what the verification records actually show.
  if (v.verification?.phoneVerified) line(evidence, "Mobile number", "Verified by OTP", "VERIFIED");
  if (v.verification?.emailVerified) line(evidence, "Email", "Verified", "VERIFIED");
  for (const item of v.verification?.approvedChecklistItems ?? []) line(evidence, "Verification item approved", item, "VERIFIED");
  line(evidence, "Verification status", pretty(v.verification?.status ?? "NOT_VERIFIED"), "VERIFIED");

  // User-provided
  line(evidence, "Age", v.age);
  line(evidence, "Gender", pretty(v.gender));
  line(evidence, "Marital status", pretty(v.maritalStatus));
  if (v.hasChildren != null) line(evidence, "Children", v.hasChildren ? `Yes${v.numberOfChildren ? ` (${v.numberOfChildren})` : ""}` : "No");
  line(evidence, "Height", v.heightCm ? `${v.heightCm} cm` : null);
  line(evidence, "City", `${v.city}, ${v.country}`);
  line(evidence, "Education", [v.educationLevel, v.degree, v.institution].filter(Boolean).join(" · ") || null);
  line(evidence, "Profession", [v.profession, pretty(v.employmentType), v.jobTitle].filter(Boolean).join(" · ") || null);
  if (!v.hidden.income) line(evidence, "Monthly income", v.monthlyIncome != null ? String(v.monthlyIncome) : null);
  line(evidence, "Family", [pretty(v.familyType), pretty(v.familyStatus)].filter(Boolean).join(" · ") || null);
  if (!v.hidden.familyDetails) {
    line(evidence, "Siblings", v.numberOfBrothers != null || v.numberOfSisters != null ? `${v.numberOfBrothers ?? 0} brother(s), ${v.numberOfSisters ?? 0} sister(s)` : null);
  }
  line(evidence, "Religion", [v.religion, v.sect, v.religiousPractice].filter(Boolean).join(" · ") || null);
  line(evidence, "Languages", v.languages);
  if (v.smoking != null) line(evidence, "Smoking", v.smoking ? "Yes" : "No");
  if (v.drinking != null) line(evidence, "Drinking", v.drinking ? "Yes" : "No");

  const p = v.preference;
  const prefBits = [
    p.minAge || p.maxAge ? `age ${p.minAge ?? "any"}–${p.maxAge ?? "any"}` : null,
    p.preferredCity || p.preferredCountry ? `location ${[p.preferredCity, p.preferredCountry].filter(Boolean).join(", ")}` : null,
    p.minEducation ? `education ≥ ${p.minEducation}` : null,
    p.professionPreference && p.professionPreference !== "ANY" ? `profession ${p.professionPreference}` : null,
    p.maritalStatusPreference && p.maritalStatusPreference !== "ANY" ? `marital status ${p.maritalStatusPreference.replace(/_/g, " ").toLowerCase()}` : null,
    p.minHeightCm || p.maxHeightCm ? `height ${p.minHeightCm ?? "any"}–${p.maxHeightCm ?? "any"} cm` : null,
  ].filter(Boolean);
  line(evidence, "Partner requirements", prefBits.length ? prefBits.join("; ") : null);

  // AI observations — interpretation, clearly labelled.
  const observations: string[] = [];
  if (prefBits.length >= 4) observations.push("The partner requirements are fairly specific across several areas.");
  else if (prefBits.length > 0 && prefBits.length <= 1) observations.push("The partner requirements are brief; more detail would make matching review easier.");
  if (v.completenessPercent >= 80) observations.push(`The profile is well filled in (${v.completenessPercent}% complete by the platform's own measure).`);
  else if (v.completenessPercent < 50) observations.push(`Several sections are still empty (${v.completenessPercent}% complete by the platform's own measure).`);
  for (const o of observations) evidence.push({ label: "AI observation", value: o, source: "AI_OBSERVATION" });

  const missing = findings.filter((f) => f.label === "MISSING").map((f) => f.message);
  const conflicts = findings.filter((f) => f.label === "INCONSISTENT").map((f) => f.message);
  const questions = findings
    .filter((f) => f.label === "NEEDS_VERIFICATION" || f.label === "USER_CONFIRMATION_REQUIRED")
    .map((f) => `${f.area}: ${f.message}`);

  const suff = sufficiencyOf(v, findings);
  const headline = `${v.ref} (${v.profileCode}): ${v.age}-year-old ${pretty(v.gender)?.toLowerCase()}, ${pretty(v.maritalStatus)?.toLowerCase()}, based in ${v.city}, ${v.country}. ` +
    `${suff === "SUFFICIENT" ? "Information is sufficient for review." : suff === "PARTIAL" ? `${NEUTRAL_PHRASES.incomplete} in places.` : `${NEUTRAL_PHRASES.incomplete} — several areas are empty.`}`;

  return {
    summary: headline,
    evidence,
    alignedAreas: [],
    potentialConflicts: conflicts,
    missingInformation: missing,
    verificationQuestions: questions,
    suggestedNextStep: conflicts.length
      ? "Review the flagged inconsistencies with the member before proceeding."
      : missing.length
        ? "Request the missing information from the member."
        : questions.length
          ? "Complete the outstanding verification items."
          : "No open items detected; continue with the normal review.",
    limitations: STANDARD_LIMITATIONS,
    sufficiency: suff,
    findings,
    data: { evidenceSources: { verified: evidence.filter((e) => e.source === "VERIFIED").length, userProvided: evidence.filter((e) => e.source === "USER_PROVIDED").length, aiObservations: observations.length } },
  };
}
