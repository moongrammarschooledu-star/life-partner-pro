import type { AiPayload } from "@/lib/ai/types";

// Spec §30 — every AI output (from ANY provider, including the built-in rules
// provider) passes through this filter before an admin sees it. It is a
// rule-based guard rail, not proof of safety: it removes the specific failure
// classes the spec names and records which rule fired (never the text).
//
//  REWRITE — the offending string is replaced with neutral wording, the rest
//            of the result is kept.
//  BLOCK   — the whole result is withheld ("safety block"); nothing partial
//            is shown, because the class of problem (contact leakage, appearance
//            scoring, sensitive inference…) means the output cannot be trusted.

export type SafetyAction = "REWRITE" | "BLOCK";

export interface SafetyRule {
  id: string;
  action: SafetyAction;
  pattern: RegExp;
  neutral: string;
}

// Approved neutral vocabulary (spec §7) — used by the rules provider and as the
// replacement text below.
export const NEUTRAL_PHRASES = {
  potential: "Potential compatibility",
  aligned: "Several stated preferences align",
  review: "This area requires admin review",
  incomplete: "Information is incomplete",
  conflict: "Potential requirement conflict",
  inconsistency: "Potential inconsistency detected — Admin Review Required",
  insufficient: "Insufficient information",
} as const;

const REMOVED = "This statement was removed by the safety filter. Please review the source data.";

export const SAFETY_RULES: SafetyRule[] = [
  // ---- rewrite ---------------------------------------------------------
  {
    id: "GUARANTEE",
    action: "REWRITE",
    pattern:
      /\b(perfect(ly)? match(ed)?|perfect couple|guarantee[ds]?|ideal (spouse|partner|match)|100\s?%\s*(compatible|match|suitable)|definitely (successful|work|suit)|will (definitely |surely )?(marry|get married|accept|say yes)|sure to (succeed|work|accept)|made for each other|soul ?mates?)\b/i,
    neutral: `${NEUTRAL_PHRASES.potential}; outcomes are uncertain and ${NEUTRAL_PHRASES.review.toLowerCase()}.`,
  },
  {
    id: "SUCCESS_PROBABILITY",
    action: "REWRITE",
    pattern: /\b\d{1,3}\s?%\s*(chance|probability|likelihood|odds)\b|\b(chance|probability|likelihood|odds) of (marriage|success|acceptance|a successful)\b/i,
    neutral: "The information available is described as Sufficient, Partial or Limited; no prediction of outcomes is made.",
  },
  {
    id: "ACCUSATION",
    action: "REWRITE",
    pattern: /\b(fraud(ulent|ster)?|scam(mer)?|liar|lying|lied|fake (profile|identity|documents?|details)|criminal|cheat(er|ing|ed)|impost(o|e)r|con[- ]?(man|artist))\b/i,
    neutral: NEUTRAL_PHRASES.inconsistency,
  },
  {
    id: "COERCIVE_LANGUAGE",
    action: "REWRITE",
    pattern:
      /\b(you must (accept|agree|reply|respond|decide)|last chance|don'?t miss|running out of time|act now|limited time|you will regret|no other (option|choice)|final (chance|offer)|hurry)\b/i,
    neutral: "Please take the time you need; there is no pressure to respond by any particular date.",
  },
  {
    id: "LEGAL_CONCLUSION",
    action: "REWRITE",
    pattern: /\b(legally (valid|binding|eligible|permitted|required)|violates? the law|is illegal|illegal to|against the law|liable for)\b/i,
    neutral: "Legal questions are outside what this assistant can determine; please seek qualified advice.",
  },
  {
    id: "MARKUP",
    action: "REWRITE",
    pattern: /<\s*\/?\s*(script|iframe|object|embed|img|svg|style|link|meta|form|input|a)\b[^>]*>|javascript\s*:|\bon[a-z]{3,}\s*=\s*["']/i,
    neutral: REMOVED,
  },
  // ---- block -----------------------------------------------------------
  {
    id: "APPEARANCE_JUDGEMENT",
    action: "BLOCK",
    pattern:
      /\b(attractive(ness)?|good[- ]looking|beautiful|handsome|pretty|ugly|unattractive|plain[- ]looking|fair[- ]skinned|dark[- ]skinned|skin (colou?r|tone)|complexion|facial (features|structure|score|symmetry)|face (shape|score)|body (type|shape)|slim figure|overweight|obese)\b/i,
    neutral: REMOVED,
  },
  {
    id: "ETHNICITY_OR_RACE_INFERENCE",
    action: "BLOCK",
    pattern: /\b(race|racial|ethnic(ity)?|caste|biraderi|tribe|tribal background|skin colou?r)\b/i,
    neutral: REMOVED,
  },
  {
    id: "HEALTH_OR_PSYCHOLOGICAL_CONCLUSION",
    action: "BLOCK",
    pattern:
      /\b(diagnos(is|ed|e)|mental (illness|health (issue|condition|problem))|depress(ed|ion)|bipolar|schizo\w*|anxiety disorder|disabilit(y|ies)|chronic (illness|disease)|medical condition|personality disorder|narcissis\w*|psychopath\w*|emotionally (unstable|unfit)|mentally (ill|unfit|unstable))\b/i,
    neutral: REMOVED,
  },
  {
    id: "STEREOTYPING",
    action: "BLOCK",
    pattern:
      /\b(women|men|girls|boys|wives|husbands|daughters|sons)\s+(should|must|ought to|are (always|naturally|usually|generally))\b|\b(all|typical|most)\s+(muslims|hindus|christians|sikhs|shias?|sunnis?|ahmadis?|punjabis|pathans|sindhis|baloch|mohajirs?)\b|\b(low(er)?[- ]class|beneath (him|her|them|your)|not (of )?(good|high|equal) (status|family))\b/i,
    neutral: REMOVED,
  },
  {
    id: "SYSTEM_PROMPT_LEAK",
    action: "BLOCK",
    pattern: /\b(system prompt|my (hidden )?instructions (are|say)|ignore (all |any )?(previous|prior|above) instructions|as an ai language model|developer message)\b/i,
    neutral: REMOVED,
  },
];

// Contact patterns — leaking any of these is always a block (spec §30/§49).
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const URL_LIKE = /\bhttps?:\/\/\S+|\bwww\.[A-Za-z0-9-]+\.\S+/i;
// 10+ digits, allowing separators — profile/proposal codes (LPP-…) contain fewer contiguous digits.
const PHONE = /(?:\+|00)?\d(?:[\s().-]?\d){9,}/;

export interface SafetyContext {
  // Verbatim values that must never appear (phone, email, internal-note text,
  // exact address…) for the profiles involved in this request.
  forbiddenStrings?: string[];
}

export interface SafetyEvent {
  rule: string;
  action: "REWRITTEN" | "BLOCKED";
}

export interface TextCheck {
  text: string;
  events: SafetyEvent[];
  blocked: boolean;
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/[\s\-().]/g, "");
}

export function checkText(input: string, ctx: SafetyContext = {}): TextCheck {
  const events: SafetyEvent[] = [];
  let text = input;
  let blocked = false;

  const forbidden = (ctx.forbiddenStrings ?? []).map((f) => f.trim()).filter((f) => f.length >= 4);
  const flat = normalise(text);
  for (const f of forbidden) {
    if (text.toLowerCase().includes(f.toLowerCase()) || (/\d{6,}/.test(f) && flat.includes(normalise(f)))) {
      events.push({ rule: "PRIVATE_DATA_LEAK", action: "BLOCKED" });
      blocked = true;
      break;
    }
  }
  if (EMAIL.test(text) || URL_LIKE.test(text) || PHONE.test(text)) {
    events.push({ rule: "CONTACT_LEAK", action: "BLOCKED" });
    blocked = true;
  }

  for (const rule of SAFETY_RULES) {
    if (!rule.pattern.test(text)) continue;
    if (rule.action === "BLOCK") {
      events.push({ rule: rule.id, action: "BLOCKED" });
      blocked = true;
    } else {
      events.push({ rule: rule.id, action: "REWRITTEN" });
      text = rule.neutral;
    }
  }
  // Any remaining angle-bracket markup is neutralised even if no rule matched.
  if (/<[^>]{1,200}>/.test(text)) {
    text = text.replace(/<[^>]{1,200}>/g, "");
    events.push({ rule: "MARKUP", action: "REWRITTEN" });
  }
  return { text, events, blocked };
}

function mapStrings<T>(value: T, fn: (s: string) => string): T {
  if (typeof value === "string") return fn(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = mapStrings(v, fn);
    return out as T;
  }
  return value;
}

export interface SafetyResult {
  payload: AiPayload | null; // null when blocked
  events: SafetyEvent[];
  blocked: boolean;
}

export function applySafetyRules(payload: AiPayload, ctx: SafetyContext = {}): SafetyResult {
  const events: SafetyEvent[] = [];
  let blocked = false;
  const cleaned = mapStrings(payload, (s) => {
    const r = checkText(s, ctx);
    events.push(...r.events);
    if (r.blocked) blocked = true;
    return r.text;
  });
  return { payload: blocked ? null : cleaned, events, blocked };
}
