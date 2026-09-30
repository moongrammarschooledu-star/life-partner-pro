import type { AiPayload, Evidence } from "@/lib/ai/types";

// STEP 28 §60/§61 — CRM AI assistant. Copies src/lib/ai/analysis/risk-summary.ts's
// exact pure-builder pattern: no provider call, takes already-computed server
// facts only, never decides anything, never changes lifecycle stage, never
// sends a message, never exposes private information beyond what the caller
// already resolved server-side. Gated by the existing ai.enabled flag (no
// new gate). This module structurally cannot mutate anything — it has no
// import of consumeUsage/transitionStage/sendMessage/grantOverride/etc.

export const CRM_AI_REVIEW_LABEL = "AI-Assisted Summary — Human Review Required";

export const CRM_AI_LIMITATIONS = [
  "This summary only describes records already on file. It never decides the next step for you.",
  "It never claims payment/membership status reflects matrimonial compatibility.",
  "Only an authorised staff member can change the lifecycle stage, send a message, or take any action listed here.",
];

function line(out: Evidence[], label: string, value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined || value === "") return;
  out.push({ label, value: String(value).slice(0, 300), source: "DATABASE" });
}

export interface CrmApplicantSummaryInput {
  crmCode: string;
  lifecycleStage: string;
  verificationStatus: string;
  assignedStaffName: string | null;
  openFollowUps: number;
  overdueFollowUps: number;
  activeProposals: number;
  lastActivityDaysAgo: number | null;
  membershipPackageName: string | null;
  riskIndicatorBand: string | null; // neutral band only — never a raw score (spec §46)
  tags: string[];
}

// spec §61's exact worked example shape.
export function buildCrmApplicantSummary(input: CrmApplicantSummaryInput): AiPayload {
  const evidence: Evidence[] = [];
  line(evidence, "CRM Record", input.crmCode);
  line(evidence, "Current Stage", input.lifecycleStage.replace(/_/g, " "));
  line(evidence, "Verification", input.verificationStatus);
  line(evidence, "Assigned To", input.assignedStaffName ?? "Unassigned");
  line(evidence, "Open Follow-ups", input.openFollowUps);
  line(evidence, "Overdue Follow-ups", input.overdueFollowUps);
  line(evidence, "Active Proposals", input.activeProposals);
  line(evidence, "Last Activity (days ago)", input.lastActivityDaysAgo);
  line(evidence, "Membership Package", input.membershipPackageName);
  if (input.riskIndicatorBand) line(evidence, "Security Review Indicator", input.riskIndicatorBand);
  if (input.tags.length) line(evidence, "Tags", input.tags.join(", "));

  const suggestions: string[] = [];
  if (input.overdueFollowUps > 0) suggestions.push(`Review ${input.overdueFollowUps} overdue follow-up(s).`);
  if (input.assignedStaffName === null) suggestions.push("Assign this record to a staff member.");
  if (input.activeProposals > 0 && input.openFollowUps === 0) suggestions.push("Consider a follow-up on the active proposal.");
  if (input.lastActivityDaysAgo !== null && input.lastActivityDaysAgo > 14) suggestions.push("No activity in over two weeks — consider reaching out.");
  if (suggestions.length === 0) suggestions.push("No immediate action suggested — record looks up to date.");

  return {
    summary: `${input.crmCode} is at ${input.lifecycleStage.replace(/_/g, " ").toLowerCase()}. Verification: ${input.verificationStatus.toLowerCase()}. ${input.openFollowUps} open follow-up(s), ${input.activeProposals} active proposal(s).`,
    evidence,
    alignedAreas: [],
    potentialConflicts: [],
    missingInformation: input.assignedStaffName ? [] : ["No staff member is assigned."],
    verificationQuestions: [],
    suggestedNextStep: suggestions.join(" "),
    limitations: CRM_AI_LIMITATIONS,
    sufficiency: "SUFFICIENT",
    findings: [],
    data: { reviewLabel: CRM_AI_REVIEW_LABEL, suggestions },
  };
}

export interface CrmTimelineSummaryInput {
  eventCount: number;
  stageChanges: number;
  spanDays: number;
  lastEventLabel: string | null;
}

export function buildCrmTimelineSummary(input: CrmTimelineSummaryInput): AiPayload {
  const evidence: Evidence[] = [];
  line(evidence, "Events recorded", input.eventCount);
  line(evidence, "Lifecycle changes", input.stageChanges);
  line(evidence, "Timeline span (days)", input.spanDays);
  line(evidence, "Most recent event", input.lastEventLabel);

  return {
    summary: `${input.eventCount} event(s) recorded over ${input.spanDays} day(s), including ${input.stageChanges} lifecycle change(s).`,
    evidence,
    alignedAreas: [],
    potentialConflicts: [],
    missingInformation: input.eventCount === 0 ? ["No activity recorded yet."] : [],
    verificationQuestions: [],
    suggestedNextStep: "Review the full timeline for context before taking any action.",
    limitations: CRM_AI_LIMITATIONS,
    sufficiency: input.eventCount === 0 ? "LIMITED" : "SUFFICIENT",
    findings: [],
    data: { reviewLabel: CRM_AI_REVIEW_LABEL },
  };
}

// A CRM-scoped follow-up draft — reuses the SAME drafting rule the existing
// src/app/api/admin/ai/followup-draft/route.ts already applies (never
// auto-sent; a human copies/edits/sends it through the real communication
// path). This function returns TEXT ONLY, never a "send" action.
export function draftCrmFollowupMessage(input: { applicantFirstName: string; purpose: string; lifecycleStage: string }): string {
  return `Hi ${input.applicantFirstName}, following up regarding ${input.purpose.toLowerCase()}. Let us know if you have any questions or updates. — Life Partner Pro Team`;
}
