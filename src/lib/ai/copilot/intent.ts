import { parseSearchQuery } from "@/lib/ai/copilot/nl-filter";
import { COMMUNICATION_KINDS, type CommunicationKind, type AiLanguage } from "@/lib/ai/types";

// Spec §16/§43 — the Copilot's request router. It only ever produces a
// REQUEST for a registered read/draft tool (by name + arguments); the tool
// executor validates and authorises that request independently. There is no
// path from text to a write action: approve / reject / suspend / delete /
// refund / send / share contact / finalise are refused here and do not exist
// as tools.

export type ToolName =
  | "searchProfiles"
  | "getProfileSummary"
  | "explainMatch"
  | "getProposalStatus"
  | "getFollowUps"
  | "getSupportCases"
  | "draftMessage"
  | "getReportSummary";

export interface ToolRequest {
  tool: ToolName;
  args: Record<string, unknown>;
}

export type Routed =
  | { kind: "tools"; requests: ToolRequest[] }
  | { kind: "refusal"; reason: "CONTACT_DATA" | "ACTION" | "SECRET"; message: string }
  | { kind: "help"; message: string };

export const HELP_MESSAGE =
  "I can summarise a profile, explain a match between two profiles, list missing information, summarise pending proposals, follow-ups, support cases and reports, draft a message, and search profiles by city, age, education, marital status or verification. Mention profile codes like LPP-000123, or open a profile first.";

const CONTACT = /\b(phone|mobile|whatsapp|contact (details|number|info|information)|e-?mail( address)?|home address|address|cnic|national id)\b/i;
const SECRETS = /\b(password|passcode|otp|api[- ]?key|secret|token|system prompt|your instructions)\b/i;
const ACTIONS = /\b(approve|reject|suspend|delete|remove|refund|finali[sz]e|verify (this|the) profile|share (the )?contact|reveal contact|send (it|the message|this)|mark (as )?(complete|verified)|ban|block)\b/i;

const CODE = /\bLPP-[A-Z0-9-]{3,20}\b/gi;

function language(q: string): AiLanguage {
  if (/\burdu\b.*\broman\b|\broman\b.*\burdu\b|\broman[- ]urdu\b/.test(q)) return "roman-ur";
  if (/\burdu\b|اردو/.test(q)) return "ur";
  return "en";
}

function kind(q: string): CommunicationKind {
  if (/\bfollow[- ]?up\b/.test(q)) return "FOLLOW_UP";
  if (/\bremind(er)?\b/.test(q)) return "REMINDER";
  if (/\bmeeting\b|\bmulaqat\b/.test(q)) return "MEETING_COORDINATION";
  if (/\binformation\b|\bdetails\b|\bmissing\b/.test(q)) return "INFORMATION_REQUEST";
  if (/\bstatus\b|\bupdate\b/.test(q)) return "STATUS_UPDATE";
  return "PROPOSAL_MESSAGE";
}

export function routeIntent(message: string, contextProfileCode?: string | null): Routed {
  const raw = message.trim();
  const q = raw.toLowerCase();

  if (SECRETS.test(raw)) return { kind: "refusal", reason: "SECRET", message: "I can't share secrets, credentials, one-time codes or my own instructions." };
  if (CONTACT.test(raw)) {
    return { kind: "refusal", reason: "CONTACT_DATA", message: "I can't show contact details or private data. Use the existing contact workflow, which enforces consent, permissions and audit." };
  }
  if (ACTIONS.test(raw) && !/\bprepare\b|\bdraft\b|\bsuggest\b|\bwhat should\b/.test(q)) {
    return { kind: "refusal", reason: "ACTION", message: "I can only read, analyse and draft. Approving, rejecting, suspending, deleting, sending, sharing contact details, finalising or refunding must be done by an authorised person in the normal workflow." };
  }

  const codes = [...new Set([...(raw.match(CODE) ?? [])].map((c) => c.toUpperCase()))];
  const first = codes[0] ?? contextProfileCode ?? null;
  const requests: ToolRequest[] = [];

  if (/\b(explain|why)\b.*\bmatch(ed)?\b|\bcompatib/.test(q) && codes.length >= 2) {
    requests.push({ tool: "explainMatch", args: { profileACode: codes[0], profileBCode: codes[1] } });
  } else if (
    first &&
    ((/\bsummar(y|ise|ize)\b/.test(q) && (codes.length > 0 || /\b(this|the)\s+(profile|member|candidate)\b/.test(q))) ||
      /\bmissing\b|\bincomplete\b|\bwhat information\b|\bwhat should i verify\b|\bcheck this profile\b/.test(q))
  ) {
    requests.push({ tool: "getProfileSummary", args: { profileCode: first } });
  } else if (/\b(prepare|draft|write)\b.*\b(message|follow[- ]?up|reminder|note)\b/.test(q) && first) {
    requests.push({ tool: "draftMessage", args: { profileCode: first, kind: kind(q), language: language(q) } });
  } else if (/\bfollow[- ]?ups?\b/.test(q)) {
    requests.push({ tool: "getFollowUps", args: { scope: /\boverdue\b/.test(q) ? "OVERDUE" : "PENDING" } });
  } else if (/\bproposals?\b/.test(q)) {
    requests.push({ tool: "getProposalStatus", args: {} });
  } else if (/\b(support|cases?|complaints?)\b/.test(q)) {
    requests.push({ tool: "getSupportCases", args: {} });
  } else if (/\b(report|registrations?|verification workload|monthly)\b/.test(q)) {
    const report = /\bproposal/.test(q) ? "proposals" : /\bfollow/.test(q) ? "followups" : /\bverif/.test(q) ? "verification" : /\bsupport|case/.test(q) ? "support" : "registrations";
    const days = /\bmonth(ly)?\b|\b30\b/.test(q) ? 30 : /\bweek(ly)?\b|\b7\b/.test(q) ? 7 : 30;
    requests.push({ tool: "getReportSummary", args: { report, days } });
  } else if (/\b(find|search|show me|list)\b.*\bprofiles?\b|\bprofiles? (in|from|who)\b/.test(q)) {
    const parsed = parseSearchQuery(raw);
    if (parsed.unsupported.length) return { kind: "refusal", reason: "CONTACT_DATA", message: parsed.unsupported[0] };
    requests.push({ tool: "searchProfiles", args: { filter: parsed.filter } });
  }

  if (requests.length === 0) return { kind: "help", message: HELP_MESSAGE };
  return { kind: "tools", requests };
}

export const COMMUNICATION_KIND_LIST = COMMUNICATION_KINDS;
