// STEP 29 §33/§34 — marketing content policy. A pure, deterministic LEXICAL safeguard (English, Roman Urdu and Urdu
// script term lists). It stops obvious guaranteed-outcome claims, sensitive-attribute targeting, PII/profile
// disclosure and public-browsing implications from reaching review or launch. It is NOT a legal review and says so:
// a human reviewer still approves every piece of content.

export type PolicySeverity = "BLOCK" | "WARN";

export type PolicyRule =
  | "GUARANTEED_OUTCOME"
  | "UNSUBSTANTIATED_SUPERLATIVE"
  | "UNSUBSTANTIATED_STATISTIC"
  | "URGENCY_PRESSURE"
  | "SENSITIVE_ATTRIBUTE_TARGETING"
  | "PRIVACY_OVERCLAIM"
  | "PII_OR_PROFILE_DISCLOSURE"
  | "PUBLIC_BROWSING_IMPLICATION"
  | "VERIFICATION_OVERCLAIM"
  | "FINANCIAL_CLAIM"
  | "MINOR_TARGETING"
  | "MISSING_REQUIRED_DISCLOSURE";

export interface PolicyFinding {
  rule: PolicyRule;
  severity: PolicySeverity;
  field?: string;
  snippet: string;
}

export interface PolicyScanResult {
  pass: boolean;
  blocked: number;
  warnings: number;
  findings: PolicyFinding[];
  disclaimer: string;
}

export const POLICY_DISCLAIMER = "Automated lexical check only — not a legal review. A human reviewer must approve all marketing content.";

interface TextRule {
  rule: PolicyRule;
  severity: PolicySeverity;
  patterns: RegExp[];
}

// Matching is case-insensitive; Urdu-script terms are matched literally.
const TEXT_RULES: TextRule[] = [
  {
    rule: "GUARANTEED_OUTCOME",
    severity: "BLOCK",
    patterns: [
      /\bguarantee[sd]?\b/i,
      /\b100\s*%/i,
      /\b(sure|certain|definite)\s+(match|marriage|rishta|spouse|response)\b/i,
      /\bpakka\s+rishta\b/i,
      /\bshadi\s+guarantee\b/i,
      /\bsau\s+fisad\b/i,
      /ضمانت|گارنٹی|سو فیصد/,
    ],
  },
  {
    rule: "UNSUBSTANTIATED_SUPERLATIVE",
    severity: "BLOCK",
    patterns: [/\bperfect\s+(match|partner|spouse|rishta|life\s*partner)\b/i, /\bideal\s+(match|spouse)\b\s+(in|within)\s+\d/i],
  },
  {
    rule: "UNSUBSTANTIATED_SUPERLATIVE",
    severity: "WARN",
    patterns: [/\b(the\s+)?(best|no\.?\s?1|number\s+one|#1|leading|most\s+trusted)\b/i],
  },
  {
    rule: "UNSUBSTANTIATED_STATISTIC",
    severity: "BLOCK",
    patterns: [/\b\d[\d,.]*\+?\s*(k|m|thousand|lakh|million)?\+?\s*(happy\s+)?(verified\s+)?(profiles|members|matches|couples|marriages|families|users|rishtay|rishte)\b/i],
  },
  {
    rule: "URGENCY_PRESSURE",
    severity: "WARN",
    patterns: [/\b(last\s+chance|hurry|act\s+now|only\s+today|limited\s+(time|seats|offer|spots)|don'?t\s+miss|jaldi)\b/i, /جلدی|آخری موقع/],
  },
  {
    rule: "SENSITIVE_ATTRIBUTE_TARGETING",
    severity: "BLOCK",
    patterns: [
      /\b(religion|religious|sect|sectarian|sunni|shia|shi'?a|ahmadi|deobandi|barelvi|caste|zaat|biradari|ethnic|ethnicity|race|racial|complexion|fair[-\s]?skin(ned)?|skin\s+tone)\b/i,
      /\b(income|salary|wealthy|rich\s+(family|spouse|partner)|net\s+worth)\b/i,
      /\b(disabled|disability|divorcee|divorced|widow(er)?|medical|health\s+(status|condition))\b/i,
      /مذہب|فرقہ|ذات|برادری|آمدنی|تنخواہ|معذور|طلاق یافتہ/,
    ],
  },
  {
    rule: "PRIVACY_OVERCLAIM",
    severity: "BLOCK",
    patterns: [/\b(100\s*%|completely|totally|fully|absolutely)\s+(secure|private|anonymous|safe|confidential)\b/i, /\bunhackable\b/i, /\bnever\s+(shared|leaked)\b/i],
  },
  {
    rule: "PUBLIC_BROWSING_IMPLICATION",
    severity: "BLOCK",
    patterns: [
      /\b(browse|search|view|see)\s+(thousands\s+of\s+|all\s+|public\s+)?(profiles|members|photos|singles)\b/i,
      /\b(swipe|swiping|dating|hook-?up|hookup|chat\s+with\s+(singles|members)|flirt)\b/i,
    ],
  },
  {
    rule: "VERIFICATION_OVERCLAIM",
    severity: "WARN",
    patterns: [/\b(all|every)\s+(profiles?|members?)\s+(is|are)?\s*(fully\s+)?verified\b/i, /\bgenuine\s+profiles\s+only\b/i, /\bfake[-\s]?free\b/i],
  },
  {
    rule: "FINANCIAL_CLAIM",
    severity: "WARN",
    patterns: [/\b(money[-\s]?back|refund\s+guarantee|free\s+forever|no\s+hidden\s+(fees|charges)|risk[-\s]?free)\b/i],
  },
];

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const URL_RE = /\bhttps?:\/\/[^\s)'"]+/gi;
const PHONE_RE = /(\+?\d[\d\s().-]{8,}\d)/g;
// A quoted statement attributed to a named person ("..." — Ayesha) reads as a testimonial.
const NAMED_TESTIMONIAL_RE = /["“”][^"“”]{15,}["“”]\s*[—–-]\s*[A-Z؀-ۿ][\w؀-ۿ.'-]+/;

function snippetOf(text: string, match: RegExpMatchArray | null): string {
  if (!match || match.index === undefined) return "";
  return text.slice(Math.max(0, match.index - 8), match.index + match[0].length + 8).replace(/\s+/g, " ").trim().slice(0, 60);
}

export interface PolicyTextInput {
  field: string;
  text: string;
}

export interface ScanInput {
  texts: PolicyTextInput[];
  // https hosts allowed to appear as links (the app's own host(s)). Anything else is an external-link finding.
  allowedUrlHosts?: string[];
  // JSON-ish targeting definition: both keys and values are scanned, and an age floor below 18 is blocked.
  targeting?: unknown;
  // Publish/launch gate: which mandatory disclosures are present.
  requiredDisclosures?: { privacyNotice: boolean; consentBlock: boolean; disclaimer: boolean };
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function walkStrings(value: unknown, path: string, out: PolicyTextInput[], depth = 0): void {
  if (depth > 6 || value === null || value === undefined) return;
  if (typeof value === "string") {
    out.push({ field: path, text: value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => walkStrings(v, `${path}[${i}]`, out, depth + 1));
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out.push({ field: `${path}.${k}#key`, text: k });
      walkStrings(v, `${path}.${k}`, out, depth + 1);
    }
  }
}

function minAgeOf(targeting: unknown): number | null {
  if (!targeting || typeof targeting !== "object") return null;
  const t = targeting as Record<string, unknown>;
  const raw = t.ageMin ?? t.age_min ?? t.minAge ?? (t.age as { min?: unknown } | undefined)?.min;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function scanMarketingContent(input: ScanInput): PolicyScanResult {
  const findings: PolicyFinding[] = [];
  const texts = [...input.texts];
  if (input.targeting !== undefined) walkStrings(input.targeting, "targeting", texts);
  const allowedHosts = new Set((input.allowedUrlHosts ?? []).map((h) => h.toLowerCase()));

  for (const { field, text } of texts) {
    if (!text) continue;
    for (const r of TEXT_RULES) {
      for (const p of r.patterns) {
        const m = text.match(p);
        if (m) {
          findings.push({ rule: r.rule, severity: r.severity, field, snippet: snippetOf(text, m) });
          break;
        }
      }
    }
    const email = text.match(EMAIL_RE);
    if (email) findings.push({ rule: "PII_OR_PROFILE_DISCLOSURE", severity: "BLOCK", field, snippet: "[email address]" });
    for (const p of text.matchAll(PHONE_RE)) {
      if (p[0].replace(/\D/g, "").length >= 10) {
        findings.push({ rule: "PII_OR_PROFILE_DISCLOSURE", severity: "BLOCK", field, snippet: "[phone number]" });
        break;
      }
    }
    for (const u of text.matchAll(URL_RE)) {
      const host = hostOf(u[0]);
      if (!host || !allowedHosts.has(host)) {
        findings.push({ rule: "PII_OR_PROFILE_DISCLOSURE", severity: "BLOCK", field, snippet: `[external link: ${host ?? "invalid"}]` });
        break;
      }
    }
    if (NAMED_TESTIMONIAL_RE.test(text)) findings.push({ rule: "PII_OR_PROFILE_DISCLOSURE", severity: "BLOCK", field, snippet: "[named testimonial]" });
    if (/\b(testimonial|success\s+stor(y|ies)|happy\s+couple)\b/i.test(text)) {
      findings.push({ rule: "PII_OR_PROFILE_DISCLOSURE", severity: "BLOCK", field, snippet: "[testimonial or success-story claim — only legitimately collected, consented content may be published through review]" });
    }
  }

  const minAge = minAgeOf(input.targeting);
  if (minAge !== null && minAge < 18) findings.push({ rule: "MINOR_TARGETING", severity: "BLOCK", field: "targeting.ageMin", snippet: `minimum age ${minAge}` });

  const d = input.requiredDisclosures;
  if (d) {
    if (!d.privacyNotice) findings.push({ rule: "MISSING_REQUIRED_DISCLOSURE", severity: "BLOCK", snippet: "privacy notice" });
    if (!d.consentBlock) findings.push({ rule: "MISSING_REQUIRED_DISCLOSURE", severity: "BLOCK", snippet: "consent block" });
    if (!d.disclaimer) findings.push({ rule: "MISSING_REQUIRED_DISCLOSURE", severity: "BLOCK", snippet: "disclaimer section" });
  }

  const blocked = findings.filter((f) => f.severity === "BLOCK").length;
  return { pass: blocked === 0, blocked, warnings: findings.length - blocked, findings, disclaimer: POLICY_DISCLAIMER };
}

// A scan result is only valid for the exact content it scanned.
export function assertScanFresh(scanHash: string | null | undefined, currentHash: string | null | undefined): boolean {
  return !!scanHash && !!currentHash && scanHash === currentHash;
}
