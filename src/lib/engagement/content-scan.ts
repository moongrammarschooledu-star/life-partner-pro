import { scanMarketingContent, type PolicyFinding } from "@/lib/marketing/content-policy";
import { PRESSURE_PATTERNS } from "@/lib/engagement/phrases";
import { checkText } from "@/lib/ai/safety";

// STEP 30 — the pre-publish check for every piece of engagement text an admin writes (task titles, guide articles,
// announcements, survey questions). It is the marketing content policy PLUS the engagement rules:
//   - no urgency, scarcity, fear, pressure or comparison wording (e.g. "Act now or you will lose your chance"),
//   - no outcome promises or predictions (already BLOCKed by the marketing policy; repeated here for the Roman-Urdu/Urdu forms),
//   - nothing the AI safety filter would rewrite (links, phone numbers, accusations, adverse-decision language).
// It is a lexical safeguard, not legal review: a human reviewer still approves publication.

export interface EngagementFinding {
  rule: string;
  severity: "BLOCK" | "WARN";
  field?: string;
  snippet: string;
}

export interface EngagementScanResult {
  pass: boolean;
  blocked: number;
  warnings: number;
  findings: EngagementFinding[];
  disclaimer: string;
}

export const ENGAGEMENT_SCAN_DISCLAIMER = "Automated lexical check only - not a legal review. A human reviewer must approve all engagement content.";

export function scanEngagementContent(input: { texts: Array<{ field: string; text: string }>; allowedUrlHosts?: string[] }): EngagementScanResult {
  const base = scanMarketingContent({ texts: input.texts, allowedUrlHosts: input.allowedUrlHosts });
  // The marketing policy treats pressure wording as a WARNING; for engagement it is a BLOCK (the spec forbids artificial urgency).
  const findings: EngagementFinding[] = base.findings.map((f: PolicyFinding) => ({ rule: f.rule, severity: f.rule === "URGENCY_PRESSURE" ? "BLOCK" : f.severity, field: f.field, snippet: f.snippet }));

  for (const { field, text } of input.texts) {
    if (!text) continue;
    for (const p of PRESSURE_PATTERNS) {
      const m = text.match(p);
      if (m) {
        findings.push({ rule: "PRESSURE_OR_OUTCOME_WORDING", severity: "BLOCK", field, snippet: m[0].slice(0, 40) });
        break;
      }
    }
    const safety = checkText(text);
    if (safety.blocked) findings.push({ rule: "UNSAFE_TEXT", severity: "BLOCK", field, snippet: safety.events[0]?.rule ?? "unsafe" });
  }

  const blocked = findings.filter((f) => f.severity === "BLOCK").length;
  return { pass: blocked === 0, blocked, warnings: findings.length - blocked, findings, disclaimer: ENGAGEMENT_SCAN_DISCLAIMER };
}
