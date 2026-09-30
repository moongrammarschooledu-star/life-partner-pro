import type { AiPayload, AiLanguage, CommunicationKind } from "@/lib/ai/types";
import { buildCommunicationDraft, DRAFT_LIMITATIONS } from "@/lib/ai/analysis/drafts";

// Spec §15 — follow-up suggestions. The assistant suggests a next action and a
// draft; it never sends anything and never marks a follow-up complete.

export interface FollowUpContext {
  profileCode: string;
  purpose: string | null;
  status: string; // PENDING | COMPLETED | CANCELLED | ... (STEP 28 extends this with SCHEDULED/IN_PROGRESS/WAITING_FOR_USER/WAITING_FOR_STAFF/OVERDUE/ESCALATED/REOPENED)
  dueDate: Date;
  priority: string;
  proposalStatus: string | null;
  now: Date;
  // STEP 28 — set only when this follow-up is CRM-linked (FollowUp.crmRecordId).
  crmCode?: string;
  lifecycleStage?: string;
}

// STEP 28 — a CRM-linked follow-up can carry any of the extended
// FollowUpStatus values, not just PENDING; every one of these is still
// "open" in the sense that a next action can be suggested. COMPLETED/
// CANCELLED remain the only terminal statuses.
const OPEN_STATUSES = ["PENDING", "SCHEDULED", "IN_PROGRESS", "WAITING_FOR_USER", "WAITING_FOR_STAFF", "OVERDUE", "ESCALATED", "REOPENED"];

export type FollowUpAction = "GENTLE_REMINDER" | "REQUEST_RESPONSE" | "MEETING_CONFIRMATION" | "ADMIN_REVIEW" | "REQUEST_MISSING_INFO";

const KIND_FOR: Record<FollowUpAction, CommunicationKind | null> = {
  GENTLE_REMINDER: "REMINDER",
  REQUEST_RESPONSE: "FOLLOW_UP",
  MEETING_CONFIRMATION: "MEETING_COORDINATION",
  ADMIN_REVIEW: null,
  REQUEST_MISSING_INFO: "INFORMATION_REQUEST",
};

export function daysOverdue(ctx: Pick<FollowUpContext, "dueDate" | "now">): number {
  return Math.max(0, Math.floor((ctx.now.getTime() - ctx.dueDate.getTime()) / 86_400_000));
}

export function suggestFollowUpActions(ctx: FollowUpContext): FollowUpAction[] {
  if (!OPEN_STATUSES.includes(ctx.status)) return [];
  const overdue = daysOverdue(ctx);
  const purpose = (ctx.purpose ?? "").toLowerCase();
  const out: FollowUpAction[] = [];
  if (/meet|mulaqat|visit/.test(purpose) || ctx.proposalStatus === "MEETING_SCHEDULED") out.push("MEETING_CONFIRMATION");
  if (/info|detail|document|missing/.test(purpose)) out.push("REQUEST_MISSING_INFO");
  if (overdue === 0) out.push("GENTLE_REMINDER");
  else if (overdue <= 7) out.push("GENTLE_REMINDER", "REQUEST_RESPONSE");
  else out.push("REQUEST_RESPONSE", "ADMIN_REVIEW"); // long overdue — a person should look at it
  return [...new Set(out)];
}

export function buildFollowUpSuggestion(ctx: FollowUpContext, language: AiLanguage): AiPayload {
  const actions = suggestFollowUpActions(ctx);
  const overdue = daysOverdue(ctx);
  const primary = actions.find((a) => KIND_FOR[a]) ?? null;
  const draft = primary ? buildCommunicationDraft({ kind: KIND_FOR[primary]!, language, recipientCode: ctx.profileCode }) : null;

  return {
    summary: !OPEN_STATUSES.includes(ctx.status)
      ? `This follow-up is ${ctx.status.toLowerCase()}; no action is suggested.`
      : overdue > 0
        ? `This follow-up is ${overdue} day(s) overdue. Suggested actions are listed below for admin review.`
        : "This follow-up is due. Suggested actions are listed below for admin review.",
    evidence: [
      { label: "Purpose", value: ctx.purpose ?? "Not recorded", source: "DATABASE" },
      { label: "Priority", value: ctx.priority, source: "DATABASE" },
      { label: "Due date", value: ctx.dueDate.toISOString().slice(0, 10), source: "DATABASE" },
      ...(ctx.proposalStatus ? [{ label: "Proposal status", value: ctx.proposalStatus, source: "DATABASE" as const }] : []),
      ...(ctx.crmCode ? [{ label: "CRM Record", value: ctx.crmCode, source: "DATABASE" as const }] : []),
      ...(ctx.lifecycleStage ? [{ label: "Lifecycle Stage", value: ctx.lifecycleStage.replace(/_/g, " "), source: "DATABASE" as const }] : []),
    ],
    alignedAreas: [],
    potentialConflicts: [],
    missingInformation: ctx.purpose ? [] : ["The follow-up has no recorded purpose."],
    verificationQuestions: [],
    suggestedNextStep: actions.length ? `Suggested: ${actions.map((a) => a.replace(/_/g, " ").toLowerCase()).join(", ")}.` : null,
    limitations: [...DRAFT_LIMITATIONS, "Nothing is sent or completed automatically; an admin decides."],
    sufficiency: ctx.purpose ? "SUFFICIENT" : "PARTIAL",
    data: { actions, daysOverdue: overdue, draft: (draft?.data as { draft?: unknown } | undefined)?.draft ?? null, sent: false },
  };
}
