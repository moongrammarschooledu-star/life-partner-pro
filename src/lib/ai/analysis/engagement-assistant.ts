import { computeJourney } from "@/lib/engagement/journey";
import { computeNextActions, nextActionDisclaimer } from "@/lib/engagement/next-action";
import { hasPressureWording, JOURNEY_DISCLAIMER } from "@/lib/engagement/phrases";
import { scanEngagementContent } from "@/lib/engagement/content-scan";
import type { EngagementSnapshot } from "@/lib/engagement/types";
import type { AiPayload, Evidence } from "@/lib/ai/types";

// STEP 30 - engagement assistant. A PURE, deterministic builder over server-computed platform activity (journey stage, next steps,
// counts) and an APPROVED PHRASE LIBRARY. No generative model is called, nothing is sent, scheduled or approved, and this module
// deliberately imports no messaging, approval, suspension, contact-sharing, finance or proposal-decision code (a structure test
// enforces it). The assistant never predicts whether someone will marry, respond or leave, never labels a person, never uses the
// internal activity score, and never writes urgency or pressure wording: every suggestion is checked before it is returned.

export const ENGAGEMENT_AI_REVIEW_LABEL = "AI-Assisted Summary - Human Review Required";

export const ENGAGEMENT_AI_LIMITATIONS = [
  "This summary describes recorded platform activity only. It does not measure quality, compatibility or likelihood of any outcome.",
  "It cannot send messages, schedule reminders, change a status, approve anything or make a decision about a person.",
  "Missing activity may simply mean the person has been busy or prefers to be contacted another way.",
  "Urdu wording should be checked by a native speaker before use.",
];

export type EngagementAssistMode = "JOURNEY_SUMMARY" | "NEXT_ACTION_EXPLANATION" | "REMINDER_DRAFT" | "CONTENT_SUGGESTION" | "FEEDBACK_SUMMARY" | "ANALYTICS_SUMMARY";
export type EngagementLang = "EN" | "UR";

// Reminder wording: calm, optional, no deadline, no consequence. The same library the notification templates are modelled on.
export const REMINDER_DRAFTS: Record<EngagementLang, Record<string, string[]>> = {
  EN: {
    PROFILE_INCOMPLETE: ["Your profile has a few sections you can finish whenever you are ready.", "When you have a moment, you can add the remaining details to your profile."],
    VERIFICATION_STALLED: ["Your verification is waiting on a few items. You can add them whenever it suits you.", "If you need help with verification, our team is happy to assist."],
    PROPOSAL_PENDING: ["A proposal is waiting for you to review. Take the time you need.", "You have a proposal to look at when you are ready."],
    MEETING_UNCONFIRMED: ["A meeting request is waiting for your reply. You can respond when convenient.", "There is a meeting request you can review at your own pace."],
    INACTIVITY: ["It has been a while. Your account is here whenever you would like to continue.", "We are here whenever you want to pick things up again."],
    MEMBERSHIP_EXPIRING: ["Your current membership period ends on the date shown in your account. You can review your options there.", "A note that your membership period is ending. Your account page shows the details."],
  },
  UR: {
    PROFILE_INCOMPLETE: ["آپ کی پروفائل کے کچھ حصے باقی ہیں، جب سہولت ہو مکمل کر لیجیے۔", "جب وقت ملے، پروفائل میں باقی تفصیلات شامل کر سکتے ہیں۔"],
    VERIFICATION_STALLED: ["آپ کی تصدیق کے لیے چند چیزیں باقی ہیں، جب مناسب ہو شامل کر دیجیے۔", "تصدیق میں مدد چاہیے تو ہماری ٹیم حاضر ہے۔"],
    PROPOSAL_PENDING: ["ایک تجویز آپ کے جائزے کی منتظر ہے۔ اپنی سہولت کے مطابق وقت لیجیے۔"],
    MEETING_UNCONFIRMED: ["ملاقات کی ایک درخواست آپ کے جواب کی منتظر ہے، جب سہولت ہو جواب دے دیجیے۔"],
    INACTIVITY: ["کافی دن ہو گئے ہیں۔ آپ کا اکاؤنٹ حاضر ہے، جب چاہیں دوبارہ شروع کر سکتے ہیں۔"],
    MEMBERSHIP_EXPIRING: ["آپ کی موجودہ رکنیت کی مدت اکاؤنٹ میں دی گئی تاریخ پر ختم ہو رہی ہے۔ تفصیل وہاں دیکھ سکتے ہیں۔"],
  },
};

export const CONTENT_TOPICS = [
  "How to complete your profile step by step",
  "What verification involves and how long each step usually takes",
  "How proposals work and how to respond at your own pace",
  "How your family can be involved, and how you control what they see",
  "How your privacy settings work",
  "What to expect from a first meeting",
  "How to contact the support team",
];

function line(out: Evidence[], label: string, value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return;
  out.push({ label, value: String(value).slice(0, 300), source: "DATABASE" });
}

const safe = (texts: string[]) => texts.filter((t) => !hasPressureWording(t) && scanEngagementContent({ texts: [{ field: "suggestion", text: t }] }).pass);

export interface EngagementAssistInput {
  mode: EngagementAssistMode;
  language?: EngagementLang;
  // per-person modes: the server-built snapshot of ONE applicant the admin may already see
  snapshot?: EngagementSnapshot;
  reminderKind?: string;
  // aggregate-only numbers for the summary modes
  feedback?: { total: number; byType: Record<string, number>; byStatus: Record<string, number> };
  analytics?: { windowDays: number; registered: number; profileCompleted: number; verified: number; remindersSent: number; reengagementRate: number | null };
}

export function buildEngagementAssist(input: EngagementAssistInput): AiPayload {
  const lang: EngagementLang = input.language === "UR" ? "UR" : "EN";
  const evidence: Evidence[] = [];
  line(evidence, "Mode", input.mode.replace(/_/g, " ").toLowerCase());
  line(evidence, "Language", lang);

  let summary = "";
  let nextStep: string | null = "Review the wording, edit it as needed, and use the normal approval process before anything is sent.";
  const alignedAreas: string[] = [];
  const missing: string[] = [];
  let suggestions: string[] = [];

  switch (input.mode) {
    case "JOURNEY_SUMMARY":
    case "NEXT_ACTION_EXPLANATION": {
      const s = input.snapshot;
      if (!s) {
        summary = "No activity record was available for this person.";
        missing.push("Recorded platform activity");
        nextStep = null;
        break;
      }
      const journey = computeJourney(s);
      const actions = computeNextActions(s);
      for (const st of journey.stages) line(evidence, st.label, st.stateLabel);
      line(evidence, "Profile completion", `${s.profile.completion}%`);
      line(evidence, "Proposals awaiting a response", s.proposals.awaitingMyResponse);
      line(evidence, "Meetings awaiting confirmation", s.meetings.awaitingConfirmation);
      const done = journey.stages.filter((x) => x.state === "COMPLETED").length;
      alignedAreas.push(...journey.stages.filter((x) => x.state === "COMPLETED").map((x) => x.label));
      if (input.mode === "JOURNEY_SUMMARY") {
        summary = `${done} of ${journey.stages.length} journey stages are recorded as completed. ${journey.note ?? ""}`.trim();
        nextStep = actions[0] ? `A possible next step to offer: ${actions[0].title}.` : "No outstanding step is recorded.";
      } else {
        summary = actions.length ? `${actions.length} step(s) are open. Each is listed in order, not by importance or urgency.` : "No outstanding step is recorded for this person.";
        suggestions = actions.map((a) => `${a.title} - ${a.reason}`);
        missing.push(...s.missingSections.map((m) => `${m} section has empty fields`));
        nextStep = actions[0] ? actions[0].title : null;
      }
      suggestions = suggestions.length ? suggestions : [];
      break;
    }
    case "REMINDER_DRAFT": {
      const kind = input.reminderKind && REMINDER_DRAFTS[lang][input.reminderKind] ? input.reminderKind : "PROFILE_INCOMPLETE";
      suggestions = safe(REMINDER_DRAFTS[lang][kind]);
      line(evidence, "Reminder type", kind.replace(/_/g, " ").toLowerCase());
      summary = `${suggestions.length} reminder draft(s) from the approved phrase library.`;
      break;
    }
    case "CONTENT_SUGGESTION": {
      suggestions = safe(CONTENT_TOPICS);
      summary = `${suggestions.length} guide article topic(s) that help people understand the process.`;
      nextStep = "Write the article in plain language and submit it for review.";
      break;
    }
    case "FEEDBACK_SUMMARY": {
      const f = input.feedback;
      if (!f || f.total === 0) {
        summary = "No feedback has been received in this period.";
        missing.push("Feedback submissions");
        nextStep = null;
        break;
      }
      line(evidence, "Total feedback", f.total);
      for (const [k, v] of Object.entries(f.byType)) line(evidence, `Type: ${k.replace(/_/g, " ").toLowerCase()}`, v);
      for (const [k, v] of Object.entries(f.byStatus)) line(evidence, `Status: ${k.replace(/_/g, " ").toLowerCase()}`, v);
      summary = `${f.total} feedback item(s) received. Counts by type and status are shown; individual comments are not summarised here.`;
      nextStep = "Open the feedback list to read and handle new items.";
      break;
    }
    case "ANALYTICS_SUMMARY": {
      const a = input.analytics;
      if (!a) {
        summary = "No engagement analytics were available.";
        nextStep = null;
        break;
      }
      line(evidence, "Period (days)", a.windowDays);
      line(evidence, "Registered", a.registered);
      line(evidence, "Profile completed", a.profileCompleted);
      line(evidence, "Verification completed", a.verified);
      line(evidence, "Reminders sent", a.remindersSent);
      line(evidence, "Re-engagement response rate", a.reengagementRate === null ? "Not enough data" : `${a.reengagementRate}%`);
      summary = `In the last ${a.windowDays} days: ${a.registered} registered, ${a.profileCompleted} completed a profile, ${a.verified} completed verification. These are counts of recorded activity, not predictions.`;
      nextStep = a.reengagementRate === null ? "Re-engagement results will appear once enough reminders have been sent." : null;
      break;
    }
  }

  return {
    summary: summary.slice(0, 1990),
    evidence: evidence.slice(0, 60),
    alignedAreas: alignedAreas.slice(0, 40),
    potentialConflicts: [],
    missingInformation: missing.slice(0, 40),
    verificationQuestions: [],
    suggestedNextStep: nextStep ? nextStep.slice(0, 290) : null,
    limitations: [ENGAGEMENT_AI_REVIEW_LABEL, ...ENGAGEMENT_AI_LIMITATIONS, input.mode === "JOURNEY_SUMMARY" ? JOURNEY_DISCLAIMER[lang] : nextActionDisclaimer(lang)].map((l) => l.slice(0, 290)),
    sufficiency: input.snapshot || input.feedback || input.analytics || suggestions.length ? "SUFFICIENT" : "LIMITED",
    data: { suggestions, reviewLabel: ENGAGEMENT_AI_REVIEW_LABEL },
  };
}
