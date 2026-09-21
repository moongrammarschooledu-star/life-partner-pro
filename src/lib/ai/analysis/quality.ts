import type { Finding, Sufficiency } from "@/lib/ai/types";
import type { AiProfileView } from "@/lib/ai/profile-view";
import { NEUTRAL_PHRASES } from "@/lib/ai/safety";

// Spec §10/§11/§12/§51 — data-quality and contradiction detection.
// Findings are labelled MISSING / INCONSISTENT / NEEDS_VERIFICATION /
// USER_CONFIRMATION_REQUIRED and always worded as "potential … — admin review
// required". Nothing here rejects, suspends or accuses; fraud is never
// concluded from these observations.

const HIGHER_DEGREE = /\b(bachelor|b\.?sc|b\.?a\b|b\.?s\b|mba|master|m\.?sc|m\.?a\b|mphil|ph\.?d|doctor(ate)?|mbbs|bds|llb|llm|engineer(ing)?)\b/i;
const POSTGRAD = /\b(master|m\.?sc|mphil|ph\.?d|doctor(ate)?|mba)\b/i;
const LOW_LEVELS = new Set(["Primary", "Middle", "Matric"]);
const JOB_TYPES = new Set(["GOVERNMENT", "PRIVATE"]);

const add = (out: Finding[], label: Finding["label"], area: string, message: string) => out.push({ label, area, message });
const inconsistency = (out: Finding[], area: string, detail: string) =>
  add(out, "INCONSISTENT", area, `${NEUTRAL_PHRASES.inconsistency}: ${detail}`);

export function detectFindings(v: AiProfileView): Finding[] {
  const out: Finding[] = [];
  const p = v.preference;

  // ---- Missing ------------------------------------------------------------
  if (!v.educationLevel) add(out, "MISSING", "Education", "Education level has not been provided.");
  if (!v.profession) add(out, "MISSING", "Profession", "Profession has not been provided.");
  if (v.hasProfessionRecord && !v.employmentType) add(out, "MISSING", "Employment", "Employment type has not been provided.");
  if (v.employmentType && JOB_TYPES.has(v.employmentType) && !v.jobTitle) add(out, "MISSING", "Employment", "Job title has not been provided.");
  if (v.educationLevel && ["Bachelors", "Masters", "MPhil", "PhD"].includes(v.educationLevel) && !v.degree) {
    add(out, "MISSING", "Education", "Degree details have not been provided.");
  }
  if (!v.hasFamilyRecord) add(out, "MISSING", "Family", "Family information has not been provided.");
  if (!v.religion && v.hasLifestyleRecord) add(out, "MISSING", "Lifestyle", "Religion has not been provided.");

  const hasAnyPreference = [p.minAge, p.maxAge, p.preferredCountry, p.preferredCity, p.minEducation, p.professionPreference, p.minHeightCm, p.maxHeightCm].some(
    (x) => x != null && x !== "" && x !== "ANY"
  );
  if (!v.hasPreference || !hasAnyPreference) {
    add(out, "MISSING", "Partner requirements", "Partner requirements are incomplete — no specific preference has been stated.");
  } else {
    if (p.minAge == null && p.maxAge == null) add(out, "MISSING", "Partner requirements", "No preferred age range has been stated.");
    if (!p.preferredCountry && !p.preferredCity) add(out, "MISSING", "Partner requirements", "No preferred location has been stated.");
    const exp = (p.additionalExpectations ?? "").trim();
    if (exp && exp.length < 12) add(out, "USER_CONFIRMATION_REQUIRED", "Partner requirements", "Additional expectations are very short or unclear; clarification from the member may help.");
  }

  // ---- Needs verification ------------------------------------------------
  if (!v.verification || !v.verification.phoneVerified) add(out, "NEEDS_VERIFICATION", "Contact", "Mobile number has not been verified.");
  if (!v.verification || !v.verification.emailVerified) add(out, "NEEDS_VERIFICATION", "Contact", "Email has not been verified.");
  if (v.verification && v.verification.status !== "VERIFIED") {
    add(out, "NEEDS_VERIFICATION", "Verification", "The profile is not yet fully verified by the platform.");
  }
  if (v.heightCm != null && (v.heightCm < 120 || v.heightCm > 215)) {
    add(out, "NEEDS_VERIFICATION", "Height", "The stated height is unusual; please confirm with the member.");
  }

  // ---- Contradictions (potential inconsistencies) -------------------------
  if (!v.dateOfBirthValid || v.age < 18 || v.age > 90) {
    inconsistency(out, "Age", "the date of birth gives an age outside the expected range");
  }
  if (v.maritalStatus === "NEVER_MARRIED" && (v.hasChildren === true || (v.numberOfChildren ?? 0) > 0)) {
    inconsistency(out, "Marital status", "the profile states 'never married' and also lists children");
  }
  if (v.hasChildren === true && (v.numberOfChildren == null || v.numberOfChildren === 0)) {
    add(out, "USER_CONFIRMATION_REQUIRED", "Children", "The profile states children but no number; please confirm the number of children.");
  }
  if (v.employmentType && ["NOT_WORKING", "STUDENT"].includes(v.employmentType) && (v.jobTitle || v.companyName)) {
    inconsistency(out, "Employment", `the employment type is '${v.employmentType.replace("_", " ").toLowerCase()}' but job or company details are listed`);
  }
  if (v.profession && /\bstudent\b/i.test(v.profession) && v.employmentType && v.employmentType !== "STUDENT") {
    inconsistency(out, "Employment", "the profession mentions 'student' but the employment type differs");
  }
  if (v.educationLevel && LOW_LEVELS.has(v.educationLevel) && v.degree && HIGHER_DEGREE.test(v.degree)) {
    inconsistency(out, "Education", `the education level (${v.educationLevel}) and the degree text do not appear to match`);
  }
  if (v.educationLevel === "Bachelors" && v.degree && POSTGRAD.test(v.degree)) {
    inconsistency(out, "Education", "the education level (Bachelor's) and the degree text (postgraduate) do not appear to match");
  }
  if (p.minAge != null && p.maxAge != null && p.minAge > p.maxAge) {
    inconsistency(out, "Partner requirements", "the preferred minimum age is higher than the maximum age");
  }
  if (p.minHeightCm != null && p.maxHeightCm != null && p.minHeightCm > p.maxHeightCm) {
    inconsistency(out, "Partner requirements", "the preferred minimum height is above the maximum height");
  }
  if (!v.hidden.income && p.minIncome != null && p.maxIncome != null && p.minIncome > p.maxIncome) {
    inconsistency(out, "Partner requirements", "the preferred minimum income is above the maximum income");
  }
  return out;
}

// Information-sufficiency label (spec §35) — never a probability.
export function sufficiencyOf(v: AiProfileView, findings: Finding[] = detectFindings(v)): Sufficiency {
  const missing = findings.filter((f) => f.label === "MISSING").length;
  if (v.completenessPercent >= 80 && missing <= 1) return "SUFFICIENT";
  if (v.completenessPercent >= 50 && missing <= 4) return "PARTIAL";
  return "LIMITED";
}

// Member-facing / admin-facing completeness suggestions (spec §12, §48) — text
// only; nothing is ever written to the profile. Complements, never replaces,
// the deterministic completeness percentage (Step 8).
export function improvementSuggestions(v: AiProfileView): string[] {
  const out: string[] = [];
  const f = detectFindings(v);
  const has = (area: string, contains: string) => f.some((x) => x.area === area && x.message.toLowerCase().includes(contains));
  if (has("Employment", "job title") || has("Employment", "employment type")) {
    out.push("The profession section is incomplete. Please provide the job title and employment type.");
  }
  if (has("Education", "degree")) out.push("Please add the degree name so education can be compared accurately.");
  if (has("Partner requirements", "incomplete") || has("Partner requirements", "no specific")) {
    out.push("Partner requirements are incomplete. Consider adding a preferred age range and location.");
  }
  if (has("Partner requirements", "location")) out.push("Partner requirements are vague about location. Consider clarifying the preferred city or country.");
  if (has("Partner requirements", "age range")) out.push("Consider stating a preferred age range.");
  if (has("Partner requirements", "very short")) out.push("The additional expectations are short; a little more detail would help review.");
  if (has("Family", "not been provided")) out.push("Family information has not been provided; a short overview would help.");
  if (f.some((x) => x.label === "NEEDS_VERIFICATION" && x.area === "Contact")) out.push("Verifying the mobile number and email would strengthen the profile.");
  return out;
}
