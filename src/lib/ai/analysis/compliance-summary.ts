import type { AiPayload, Evidence, Finding } from "@/lib/ai/types";

// STEP 23 Add-on §35 — a read-only summary of existing Jurisdiction/
// ComplianceRule/processor/authority-request configuration, following the
// exact shape of src/lib/ai/analysis/summary.ts and quality.ts (a pure,
// deterministic builder — no provider call is required to produce this,
// matching those files' own "built-in provider" convention). It can only
// ever describe what is already on file and flag missing metadata (spec
// §35's own "may" list) — it never concludes compliance, legality, or a
// disclosure/reporting obligation itself. src/lib/ai/safety.ts's
// COMPLIANCE_CONCLUSION rule is the enforcement backstop even if a future
// external-provider path drifts into that framing.

export const COMPLIANCE_REVIEW_LABEL = "AI-Assisted Compliance Review — Human Legal/Compliance Review Required";

export const COMPLIANCE_SUMMARY_LIMITATIONS = [
  "This summary only describes configuration already on file — it does not determine legal compliance, applicability, or any reporting obligation.",
  "It does not interpret law or regulation; it flags what is unconfigured, expired, or awaiting review.",
  "A qualified compliance/legal reviewer must review it before any action is taken.",
];

export interface ComplianceSummaryInput {
  jurisdictionCount: number;
  activeRuleCount: number;
  rulesDueForReview: Array<{ ruleCode: string; jurisdictionCode: string; requirementType: string; reviewDate: Date | null }>;
  processorsDueForReview: Array<{ processorCode: string; name: string; complianceStatus: string; nextReviewDue: Date | null }>;
  authorityRequestsAwaitingReview: Array<{ requestCode: string; authority: string; legalReviewStatus: string; deadline: Date | null }>;
  holdsPendingRelease: Array<{ id: string; reason: string }>;
}

function line(out: Evidence[], label: string, value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return;
  out.push({ label, value: String(value).slice(0, 300), source: "USER_PROVIDED" });
}

export function buildComplianceSummary(input: ComplianceSummaryInput): AiPayload {
  const evidence: Evidence[] = [];
  line(evidence, "Configured jurisdictions", input.jurisdictionCount);
  line(evidence, "Active compliance rules", input.activeRuleCount);
  line(evidence, "Rules due for review", input.rulesDueForReview.length);
  line(evidence, "Processors due for review", input.processorsDueForReview.length);
  line(evidence, "Authority requests awaiting legal review", input.authorityRequestsAwaitingReview.length);
  line(evidence, "Holds pending release approval", input.holdsPendingRelease.length);

  const missing: string[] = [];
  if (input.jurisdictionCount === 0) missing.push("No jurisdictions are configured yet — every jurisdiction-dependent check will default to REVIEW_REQUIRED.");
  if (input.activeRuleCount === 0 && input.jurisdictionCount > 0) missing.push("Jurisdictions are configured but no rule is ACTIVE yet.");

  const questions: string[] = [
    ...input.rulesDueForReview.map((r) => `Rule ${r.ruleCode} (${r.jurisdictionCode}, ${r.requirementType}) is due for review${r.reviewDate ? ` since ${r.reviewDate.toISOString().slice(0, 10)}` : ""}.`),
    ...input.processorsDueForReview.map((p) => `Processor ${p.processorCode} (${p.name}) has complianceStatus "${p.complianceStatus}" and is due for review.`),
    ...input.authorityRequestsAwaitingReview.map((r) => `Authority request ${r.requestCode} from "${r.authority}" is awaiting legal review${r.deadline ? ` (deadline ${r.deadline.toISOString().slice(0, 10)})` : ""}.`),
    ...input.holdsPendingRelease.map((h) => `Hold ${h.id} has a release request pending approval.`),
  ];

  const findings: Finding[] = [
    ...missing.map((message): Finding => ({ label: "MISSING", area: "Compliance configuration", message })),
    ...questions.map((message): Finding => ({ label: "NEEDS_VERIFICATION", area: "Compliance review", message })),
  ];

  const openItems = missing.length + questions.length;
  const headline =
    openItems === 0
      ? `${input.jurisdictionCount} jurisdiction(s) and ${input.activeRuleCount} active rule(s) on file, with no items currently flagged for review.`
      : `${input.jurisdictionCount} jurisdiction(s) and ${input.activeRuleCount} active rule(s) on file, with ${openItems} item(s) flagged for review.`;

  return {
    summary: headline,
    evidence,
    alignedAreas: [],
    potentialConflicts: [],
    missingInformation: missing,
    verificationQuestions: questions,
    suggestedNextStep: openItems > 0 ? "Review the flagged items in the Compliance admin surface before relying on this configuration." : "No open items detected; continue routine monitoring.",
    limitations: COMPLIANCE_SUMMARY_LIMITATIONS,
    sufficiency: input.jurisdictionCount === 0 ? "LIMITED" : openItems > 0 ? "PARTIAL" : "SUFFICIENT",
    findings,
    data: { reviewLabel: COMPLIANCE_REVIEW_LABEL },
  };
}
