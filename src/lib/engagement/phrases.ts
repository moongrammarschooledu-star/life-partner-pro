// STEP 30 — the only wording the engagement layer generates itself (next-action reasons, journey labels, AI drafts). Fixed,
// neutral and bilingual. It never uses urgency, scarcity, fear, pressure or outcome language: that vocabulary is listed in
// PRESSURE_PATTERNS and enforced by the content scanner (which also rejects it in admin-written copy) and by the tests,
// which assert that every phrase here passes it.

export type Lang = "EN" | "UR";

export const PRESSURE_PATTERNS: RegExp[] = [
  /\bact\s+now\b/i, /\blast\s+chance\b/i, /\bhurry\b/i, /\bdon'?t\s+miss\b/i, /\bdo\s+not\s+miss\b/i, /\bexpires?\s+(today|tonight|soon)\b/i,
  /\blimited\s+time\b/i, /\bbefore\s+it'?s\s+too\s+late\b/i, /\byou\s+(will|'ll)\s+(lose|regret|miss)\b/i, /\blose\s+your\s+chance\b/i,
  /\bonly\s+(today|tonight|\d+\s+left)\b/i, /\brunning\s+out\b/i, /\bfinal\s+(warning|notice|reminder)\b/i, /\bimmediately\b/i, /\burgent(ly)?\b/i,
  /\bsoulmate\b/i, /\bdestined\b/i, /\bperfect\s+match\b/i, /\bguarantee[sd]?\b/i, /\b100\s*%\b/i, /\bsure\s+(match|marriage|rishta)\b/i,
  /\beveryone\s+else\b/i, /\bothers\s+are\s+(waiting|ahead)\b/i, /\bfalling\s+behind\b/i,
  /جلدی\s+کریں/, /آخری\s+موقع/, /ورنہ/, /فوری\s+طور\s+پر/, /ضمانت|گارنٹی/,
];

export function hasPressureWording(text: string): boolean {
  return PRESSURE_PATTERNS.some((p) => p.test(text));
}

export const JOURNEY_LABELS: Record<Lang, Record<string, string>> = {
  EN: {
    REGISTRATION: "Registration", PROFILE: "Profile", VERIFICATION: "Verification", MATCHING: "Matching", PROPOSAL: "Proposals", MEETING: "Meetings", FOLLOW_UP: "Follow-up",
    COMPLETED: "Completed", IN_PROGRESS: "In progress", NOT_STARTED: "Not started",
  },
  UR: {
    REGISTRATION: "رجسٹریشن", PROFILE: "پروفائل", VERIFICATION: "تصدیق", MATCHING: "میچنگ", PROPOSAL: "پروپوزلز", MEETING: "ملاقاتیں", FOLLOW_UP: "فالو اپ",
    COMPLETED: "مکمل", IN_PROGRESS: "جاری", NOT_STARTED: "شروع نہیں ہوا",
  },
};

export const JOURNEY_NOTE: Record<Lang, { paused: string; restricted: string; closed: string }> = {
  EN: {
    paused: "Your journey is paused. Contact support whenever you would like to continue.",
    restricted: "Some features are not available right now. Please contact support for details.",
    closed: "This journey is closed. Contact support if you have questions.",
  },
  UR: {
    paused: "آپ کا سفر فی الحال رکا ہوا ہے۔ جب جاری رکھنا چاہیں تو سپورٹ سے رابطہ کریں۔",
    restricted: "کچھ خصوصیات اس وقت دستیاب نہیں ہیں۔ تفصیلات کے لیے براہ کرم سپورٹ سے رابطہ کریں۔",
    closed: "یہ سفر بند ہو چکا ہے۔ سوالات ہوں تو سپورٹ سے رابطہ کریں۔",
  },
};

export const JOURNEY_DISCLAIMER: Record<Lang, string> = {
  EN: "This page only shows where your steps on the platform stand. It does not predict or promise any outcome.",
  UR: "یہ صفحہ صرف پلیٹ فارم پر آپ کے مراحل کی موجودہ صورتحال دکھاتا ہے۔ یہ کسی نتیجے کی پیش گوئی یا وعدہ نہیں کرتا۔",
};

export interface ActionPhrase {
  title: Record<Lang, string>;
  // function so a reason can carry a fact (a count, a list of missing sections)
  reason: (ctx: { items?: string; count?: number }) => Record<Lang, string>;
}

export const ACTION_PHRASES: Record<string, ActionPhrase> = {
  COMPLETE_PROFILE: {
    title: { EN: "Complete your profile", UR: "اپنی پروفائل مکمل کریں" },
    reason: ({ items }) => ({
      EN: items ? `Your profile is missing: ${items}.` : "Some profile sections are still empty.",
      UR: items ? `آپ کی پروفائل میں یہ حصے خالی ہیں: ${items}۔` : "پروفائل کے کچھ حصے ابھی خالی ہیں۔",
    }),
  },
  ADD_PHOTO: {
    title: { EN: "Add a profile photo", UR: "پروفائل تصویر شامل کریں" },
    reason: () => ({ EN: "Your profile does not have a photo yet.", UR: "آپ کی پروفائل میں ابھی کوئی تصویر نہیں ہے۔" }),
  },
  COMPLETE_VERIFICATION: {
    title: { EN: "Continue verification", UR: "تصدیق جاری رکھیں" },
    reason: () => ({ EN: "Your verification is not finished yet.", UR: "آپ کی تصدیق ابھی مکمل نہیں ہوئی۔" }),
  },
  PROVIDE_REQUESTED_INFORMATION: {
    title: { EN: "Provide the requested information", UR: "مطلوبہ معلومات فراہم کریں" },
    reason: ({ count }) => ({
      EN: `Our team has asked for ${count ?? 1} item(s) to continue your verification.`,
      UR: `ہماری ٹیم نے آپ کی تصدیق جاری رکھنے کے لیے ${count ?? 1} چیز(وں) کی درخواست کی ہے۔`,
    }),
  },
  REVIEW_PARTNER_REQUIREMENTS: {
    title: { EN: "Review your partner requirements", UR: "اپنی شریکِ حیات کی ترجیحات دیکھیں" },
    reason: () => ({ EN: "Your partner requirements have not been set yet.", UR: "آپ کی شریکِ حیات کی ترجیحات ابھی طے نہیں کی گئیں۔" }),
  },
  RESPOND_TO_PROPOSAL: {
    title: { EN: "Review a proposal", UR: "ایک پروپوزل کا جائزہ لیں" },
    reason: ({ count }) => ({
      EN: `You have ${count ?? 1} proposal(s) waiting for your response. Take the time you need.`,
      UR: `آپ کے ${count ?? 1} پروپوزل آپ کے جواب کے منتظر ہیں۔ اپنی سہولت سے وقت لیں۔`,
    }),
  },
  CONFIRM_MEETING: {
    title: { EN: "Confirm a meeting", UR: "ملاقات کی تصدیق کریں" },
    reason: ({ count }) => ({
      EN: `${count ?? 1} meeting request(s) are waiting for your reply.`,
      UR: `${count ?? 1} ملاقات کی درخواست(یں) آپ کے جواب کی منتظر ہیں۔`,
    }),
  },
  SHARE_MEETING_FEEDBACK: {
    title: { EN: "Share how the meeting went (optional)", UR: "ملاقات کے بارے میں بتائیں (اختیاری)" },
    reason: () => ({ EN: "A meeting was completed. You can tell our team what you would like to happen next, or choose not to.", UR: "ایک ملاقات مکمل ہوئی ہے۔ آپ ہماری ٹیم کو بتا سکتے ہیں کہ آگے کیا ہونا چاہیے، یا نہ بتانے کا انتخاب کر سکتے ہیں۔" }),
  },
  REVIEW_PRIVACY_SETTINGS: {
    title: { EN: "Review your notification settings", UR: "اپنی اطلاعات کی ترتیبات دیکھیں" },
    reason: () => ({ EN: "You can choose which reminders you receive and when.", UR: "آپ منتخب کر سکتے ہیں کہ کون سی یاد دہانیاں کب موصول ہوں۔" }),
  },
  CONTACT_SUPPORT: {
    title: { EN: "Contact support", UR: "سپورٹ سے رابطہ کریں" },
    reason: () => ({ EN: "Our support team can help with the next step.", UR: "اگلے قدم میں ہماری سپورٹ ٹیم مدد کر سکتی ہے۔" }),
  },
};

export const NEXT_ACTION_DISCLAIMER: Record<Lang, string> = {
  EN: "These are suggestions based on what is open on your account. You decide what to do and when.",
  UR: "یہ تجاویز آپ کے اکاؤنٹ پر کھلی چیزوں کی بنیاد پر ہیں۔ کیا کرنا ہے اور کب، یہ آپ خود طے کرتے ہیں۔",
};
