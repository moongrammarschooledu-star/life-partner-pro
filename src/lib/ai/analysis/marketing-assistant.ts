import { scanMarketingContent } from "@/lib/marketing/content-policy";
import type { AiPayload, Evidence } from "@/lib/ai/types";

// STEP 29 §32 — marketing assistant. A PURE, deterministic builder over an APPROVED PHRASE LIBRARY (the wording the
// spec prefers: potential matches, admin-assisted, verification-focused, family-friendly, trusted introductions). No
// generative model is called (none exists in this app), nothing is sent or launched, and this module deliberately has
// no import of any campaign-launch, budget, provider or messaging code — a structure test enforces that. Every
// suggestion is checked against the marketing content policy before it is returned, and everything is labelled as a
// DRAFT that a human must review. Urdu wording needs a native-speaker review before use.

export const MARKETING_AI_REVIEW_LABEL = "AI-Assisted Draft — Human Review Required";

export const MARKETING_AI_LIMITATIONS = [
  "These are drafts from a fixed library of approved phrasing. They are not legal advice and make no promise about outcomes.",
  "A person must review and approve all copy through the normal campaign review before it is used.",
  "The assistant cannot launch campaigns, change budgets, spend money, choose audiences or send messages.",
  "Urdu drafts should be checked by a native speaker before use.",
];

export type MarketingAssistMode = "HEADLINES" | "DESCRIPTIONS" | "CTAS" | "FAQ" | "LANDING_INTRO" | "CAMPAIGN_SUMMARY" | "ANALYTICS_SUMMARY" | "LEAD_FOLLOWUP";
export type MarketingLang = "EN" | "UR";

type Library = Record<"HEADLINES" | "DESCRIPTIONS" | "CTAS" | "LANDING_INTRO", string[]> & { FAQ: Array<{ q: string; a: string }> };

export const PHRASE_LIBRARY: Record<MarketingLang, Library> = {
  EN: {
    HEADLINES: [
      "Find potential matches through trusted introductions",
      "Private, admin-assisted matrimonial matchmaking",
      "A verification-focused way to explore compatible profiles",
      "Family-friendly matchmaking, handled with care",
      "Designed for trusted introductions",
    ],
    DESCRIPTIONS: [
      "Life Partner Pro is a private matrimonial platform. Our team helps you explore potential matches with care for your privacy.",
      "Share a few details and a member of our team will get in touch to explain how admin-assisted matchmaking works.",
      "A verification-focused platform where introductions are made privately, with families involved the way you prefer.",
    ],
    CTAS: ["Learn more", "Request a call", "Start your inquiry", "Talk to our team", "See how it works"],
    LANDING_INTRO: [
      "Looking for a respectful, private way to begin the search? Tell us a little about what you need and we will explain the next steps.",
      "Our admin-assisted process keeps introductions private and puts verification first.",
    ],
    FAQ: [
      { q: "Is my information public?", a: "No. Life Partner Pro is a private platform. Profiles are not browsable by the public, and contact details are shared only through the platform's consent steps." },
      { q: "What happens after I submit my details?", a: "A member of our team may contact you using the method you chose, to explain the service and answer your questions." },
      { q: "Can my family be involved?", a: "Yes. Family involvement is optional and follows the permissions you set." },
      { q: "How does verification work?", a: "Applicants can complete identity and profile checks. Verification is a review process and does not predict any outcome." },
    ],
  },
  UR: {
    HEADLINES: [
      "قابلِ اعتماد تعارف کے ذریعے ممکنہ رشتے تلاش کریں",
      "نجی اور ایڈمن کی معاونت سے رشتہ تلاش کرنے کی سہولت",
      "تصدیق پر توجہ کے ساتھ موزوں پروفائلز دیکھنے کا طریقہ",
      "خاندان کے لیے موزوں، احتیاط سے سنبھالا گیا رشتہ سروس",
    ],
    DESCRIPTIONS: [
      "لائف پارٹنر پرو ایک نجی رشتہ سروس ہے۔ ہماری ٹیم آپ کی پرائیویسی کا خیال رکھتے ہوئے ممکنہ رشتے تلاش کرنے میں مدد کرتی ہے۔",
      "چند تفصیلات دیں، ہماری ٹیم کا ایک رکن آپ سے رابطہ کر کے بتائے گا کہ ایڈمن کی معاونت سے رشتہ تلاش کیسے ہوتا ہے۔",
    ],
    CTAS: ["مزید جانیں", "کال کی درخواست کریں", "اپنی درخواست شروع کریں", "ہماری ٹیم سے بات کریں"],
    LANDING_INTRO: ["رشتہ تلاش کرنے کے لیے ایک باوقار اور نجی طریقہ چاہیے؟ ہمیں اپنی ضرورت بتائیں، ہم اگلے مراحل سمجھائیں گے۔"],
    FAQ: [
      { q: "کیا میری معلومات عوامی ہوتی ہیں؟", a: "نہیں۔ یہ ایک نجی پلیٹ فارم ہے۔ پروفائلز عوام کو نظر نہیں آتے اور رابطے کی تفصیلات صرف رضامندی کے مراحل کے ذریعے شیئر ہوتی ہیں۔" },
      { q: "تفصیلات جمع کرانے کے بعد کیا ہوتا ہے؟", a: "ہماری ٹیم کا ایک رکن آپ کے منتخب کردہ طریقے سے رابطہ کر کے سروس کی وضاحت کرے گا۔" },
    ],
  },
};

function lineOf(out: Evidence[], label: string, value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return;
  out.push({ label, value: String(value).slice(0, 300), source: "DATABASE" });
}

// Defence in depth: nothing from the library (or a future edit of it) is returned unless it passes the content policy.
function policySafe(texts: string[]): string[] {
  return texts.filter((t) => scanMarketingContent({ texts: [{ field: "suggestion", text: t }] }).pass);
}

export interface MarketingAssistInput {
  mode: MarketingAssistMode;
  language?: MarketingLang;
  objective?: string;
  // Already-computed, aggregate-only numbers for the summary modes (never lead-level data).
  summary?: {
    campaignCode?: string; status?: string; leads?: number; registrations?: number; verified?: number;
    spendMinor?: number | null; currencyCode?: string; cplMinor?: number | null; roiMessage?: string | null; insufficientDataNote?: string | null;
  };
  leadFirstName?: string;
}

export function buildMarketingAssist(input: MarketingAssistInput): AiPayload {
  const lang: MarketingLang = input.language === "UR" ? "UR" : "EN";
  const lib = PHRASE_LIBRARY[lang];
  const evidence: Evidence[] = [];
  lineOf(evidence, "Mode", input.mode.replace(/_/g, " ").toLowerCase());
  lineOf(evidence, "Language", lang);
  lineOf(evidence, "Objective", input.objective);

  let suggestions: string[] = [];
  let summary: string;
  let nextStep = "Review the draft wording, edit it for your campaign, and submit it through the normal review.";

  switch (input.mode) {
    case "HEADLINES": suggestions = policySafe(lib.HEADLINES); summary = `${suggestions.length} headline draft(s) from the approved phrase library.`; break;
    case "DESCRIPTIONS": suggestions = policySafe(lib.DESCRIPTIONS); summary = `${suggestions.length} description draft(s) from the approved phrase library.`; break;
    case "CTAS": suggestions = policySafe(lib.CTAS); summary = `${suggestions.length} call-to-action draft(s) from the approved phrase library.`; break;
    case "LANDING_INTRO": suggestions = policySafe(lib.LANDING_INTRO); summary = `${suggestions.length} landing page introduction draft(s).`; break;
    case "FAQ":
      suggestions = lib.FAQ.filter((f) => policySafe([f.q, f.a]).length === 2).map((f) => `Q: ${f.q}\nA: ${f.a}`);
      summary = `${suggestions.length} FAQ draft(s).`;
      break;
    case "CAMPAIGN_SUMMARY": {
      const s = input.summary ?? {};
      lineOf(evidence, "Campaign", s.campaignCode);
      lineOf(evidence, "Status", s.status);
      lineOf(evidence, "Leads", s.leads);
      lineOf(evidence, "Registrations", s.registrations);
      lineOf(evidence, "Verified profiles", s.verified);
      summary = `${s.campaignCode ?? "This campaign"} is ${(s.status ?? "in progress").replace(/_/g, " ").toLowerCase()}, with ${s.leads ?? 0} lead(s), ${s.registrations ?? 0} registration(s) and ${s.verified ?? 0} verified profile(s) so far. These are marketing funnel counts only, not match or marriage outcomes.`;
      nextStep = "Use the analytics view for detail; this summary only restates numbers already on screen.";
      break;
    }
    case "ANALYTICS_SUMMARY": {
      const s = input.summary ?? {};
      lineOf(evidence, "Leads", s.leads);
      lineOf(evidence, "Registrations", s.registrations);
      const spend = s.spendMinor !== null && s.spendMinor !== undefined && s.currencyCode ? `${s.currencyCode} ${(s.spendMinor / 100).toFixed(2)}` : "not yet verified";
      lineOf(evidence, "Verified spend", spend);
      lineOf(evidence, "Cost per lead", s.cplMinor != null && s.currencyCode ? `${s.currencyCode} ${(s.cplMinor / 100).toFixed(2)}` : "insufficient data");
      summary = `Leads: ${s.leads ?? 0}. Registrations: ${s.registrations ?? 0}. Verified spend: ${spend}. ${s.roiMessage ?? "Insufficient verified data for ROI calculation."}${s.insufficientDataNote ? ` ${s.insufficientDataNote}` : ""}`;
      nextStep = "Treat small samples cautiously; rates below the minimum sample are intentionally not shown.";
      break;
    }
    case "LEAD_FOLLOWUP": {
      const name = (input.leadFirstName ?? "").replace(/[^\p{L}\s'-]/gu, "").trim().slice(0, 40) || "there";
      // A text draft only. It contains no contact details, makes no promise, and is never sent by this code.
      const draft = lang === "UR"
        ? `السلام علیکم ${name}، لائف پارٹنر پرو سے رابطہ کرنے کا شکریہ۔ ہماری ٹیم آپ کی درخواست کے بارے میں مزید بات کرنا چاہے گی۔ اگر آپ رابطہ نہیں چاہتے تو براہِ کرم بتا دیں۔`
        : `Hello ${name}, thank you for your inquiry about Life Partner Pro. A member of our team would like to explain how admin-assisted matchmaking works and answer your questions. If you would rather not be contacted, just let us know.`;
      suggestions = policySafe([draft]);
      summary = "A follow-up message draft. It has NOT been sent.";
      nextStep = "A staff member must review it and send it through the normal, consent-checked channels.";
      break;
    }
  }

  return {
    summary,
    evidence,
    alignedAreas: [],
    potentialConflicts: [],
    missingInformation: suggestions.length === 0 && ["HEADLINES", "DESCRIPTIONS", "CTAS", "FAQ", "LANDING_INTRO", "LEAD_FOLLOWUP"].includes(input.mode) ? ["No drafts available for this selection."] : [],
    verificationQuestions: [],
    suggestedNextStep: nextStep,
    limitations: MARKETING_AI_LIMITATIONS,
    sufficiency: suggestions.length === 0 && ["HEADLINES", "DESCRIPTIONS", "CTAS", "FAQ", "LANDING_INTRO", "LEAD_FOLLOWUP"].includes(input.mode) ? "LIMITED" : "SUFFICIENT",
    findings: [],
    data: { reviewLabel: MARKETING_AI_REVIEW_LABEL, suggestions, sent: false, language: lang },
  };
}
