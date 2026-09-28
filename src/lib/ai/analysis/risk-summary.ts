import type { AiPayload, Evidence, Finding } from "@/lib/ai/types";

// STEP 24 — a read-only, deterministic summary of a risk case's METADATA. Like the
// compliance summary it is a pure builder: no provider call is made and no risk data
// ever leaves the system. It describes what is on file (signal types, evidence kinds,
// review history) and lists what a human reviewer should look at. It never concludes
// wrongdoing, never recommends suspending/restricting/rejecting anyone, and never
// includes free text (notes, report descriptions), contact details, or a numeric score.
// src/lib/ai/safety.ts's ACCUSATION / ADVERSE_DECISION rules are the backstop if a
// future provider path drifts.

export const RISK_REVIEW_LABEL = "AI-Assisted Analysis — Human Review Required";

export const RISK_SUMMARY_LIMITATIONS = [
  "This summary only describes records already on file. It does not conclude that anyone acted improperly.",
  "Signals are unverified indicators and can have innocent explanations (shared family devices, shared phones, travel, data-entry mistakes).",
  "It makes no recommendation about restricting, suspending or rejecting an account; only an authorised human reviewer decides, and consequential actions need approval.",
];

export interface RiskCaseSummaryInput {
  riskCode: string;
  status: string;
  riskLevel: string;
  category: string;
  openedBy: string;
  subjectKind: "APPLICANT" | "STAFF";
  ageHours: number;
  overdue: boolean;
  signals: Array<{ type: string; severity: string; confidence: string | null; status: string }>;
  evidenceTypes: string[];
  evidenceIntegrityIssues: number;
  reviewDecisions: string[];
  hasActiveRestrictions: boolean;
  linkedDuplicateCluster: boolean;
  falsePositiveSignals: number;
  cappedBySingleSignal: boolean;
}

function line(out: Evidence[], label: string, value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined || value === "") return;
  out.push({ label, value: String(value).slice(0, 300), source: "DATABASE" });
}

export function buildRiskCaseSummary(input: RiskCaseSummaryInput): AiPayload {
  const evidence: Evidence[] = [];
  line(evidence, "Case", input.riskCode);
  line(evidence, "Status", input.status);
  line(evidence, "Level (internal indicator)", input.riskLevel);
  line(evidence, "Category", input.category);
  line(evidence, "Opened by", input.openedBy);
  line(evidence, "Subject", input.subjectKind === "STAFF" ? "Staff account (privileged-access review)" : "Applicant account");
  line(evidence, "Open for (hours)", Math.round(input.ageHours));
  line(evidence, "Signals linked", input.signals.length);
  line(evidence, "Evidence items", input.evidenceTypes.length);
  line(evidence, "Review actions so far", input.reviewDecisions.length);

  const alignedAreas: string[] = [];
  if (input.evidenceTypes.length > 0) alignedAreas.push(`${input.evidenceTypes.length} evidence item(s) on file (${[...new Set(input.evidenceTypes)].join(", ")}).`);
  if (input.reviewDecisions.length > 0) alignedAreas.push(`Prior review actions recorded: ${[...new Set(input.reviewDecisions)].join(", ")}.`);

  const potentialConflicts: string[] = [];
  if (input.falsePositiveSignals > 0) potentialConflicts.push(`${input.falsePositiveSignals} signal(s) on this subject were previously marked as false positives — consider whether the same explanation applies.`);
  if (input.cappedBySingleSignal) potentialConflicts.push("The indicator level was limited because it rests on a single low-confidence signal.");
  if (input.evidenceIntegrityIssues > 0) potentialConflicts.push(`${input.evidenceIntegrityIssues} evidence item(s) failed the integrity check and need to be examined before being relied on.`);

  const missing: string[] = [];
  if (input.signals.length === 0) missing.push("No signals are linked to this case.");
  if (input.evidenceTypes.length === 0) missing.push("No evidence has been attached yet.");

  const questions: string[] = [
    "Could a shared family device, shared phone, shared network, travel or a data-entry mistake explain these signals?",
    "Has the applicant been given a chance to provide additional information?",
    ...(input.signals.some((s) => s.type === "DUPLICATE_PROFILE_SUSPECTED") ? ["Do the matching fields point to the same person, or to related family members?"] : []),
    ...(input.hasActiveRestrictions ? ["Existing restrictions are in place — do they still match the current evidence and have an end date?"] : []),
    ...(input.overdue ? ["This case is past its review due date."] : []),
  ];

  const findings: Finding[] = [
    ...missing.map((message): Finding => ({ label: "MISSING", area: "Case record", message })),
    ...potentialConflicts.map((message): Finding => ({ label: "NEEDS_VERIFICATION", area: "Case record", message })),
    ...input.signals.slice(0, 8).map((s): Finding => ({ label: "NEEDS_VERIFICATION", area: "Signal", message: `${s.type} — ${s.severity.toLowerCase()} severity, ${(s.confidence ?? "unrated").toLowerCase().replace("_", " ")} confidence, status ${s.status}. Requires review.` })),
  ];

  return {
    summary: `Case ${input.riskCode} is ${input.status.toLowerCase().replace(/_/g, " ")} with ${input.signals.length} linked signal(s). Human review is required; no action has been taken by this summary.`,
    evidence,
    alignedAreas,
    potentialConflicts,
    missingInformation: missing,
    verificationQuestions: questions,
    suggestedNextStep: "Review the linked signals and evidence, record your findings, and decide the next step yourself.",
    limitations: RISK_SUMMARY_LIMITATIONS,
    sufficiency: input.signals.length === 0 ? "LIMITED" : input.evidenceTypes.length === 0 ? "PARTIAL" : "SUFFICIENT",
    findings,
    data: { reviewLabel: RISK_REVIEW_LABEL },
  };
}
