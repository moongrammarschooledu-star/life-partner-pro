// SecureTemplateRenderer. Templates are authored by staff and rendered with recipient data, so this is a trust boundary:
//   - only whitelisted variables can be used, and every value is supplied by SERVER code, never by a template or a request;
//   - unknown variables, template-engine syntax and forbidden variable names are REJECTED (not silently dropped);
//   - values are sanitised (control characters removed, length capped) and the HTML form is escaped;
//   - URLs are limited to https on an allow-listed host and never point at local / private / metadata addresses (SSRF);
//   - the rendered text can be checked against "protected strings" (another person's phone / e-mail) so a message can never
//     leak contact details it should not carry.

export const COMMUNICATION_VARIABLES = [
  "firstName",
  "profileId",
  "proposalId",
  "meetingDate",
  "meetingTime",
  "supportCaseId",
  "verificationStatus",
  "applicationStatus",
] as const;
export type CommunicationVariable = (typeof COMMUNICATION_VARIABLES)[number];

// Legacy snake_case names used by the built-in event templates (src/lib/notifications/template-resolver.ts). Only accepted
// where a caller passes them explicitly in `allowed`.
export const LEGACY_VARIABLES = ["profile_id", "proposal_id", "meeting_date", "meeting_time"] as const;

// Names that must never become template variables, whatever the caller allows.
const FORBIDDEN_VARIABLE = /pass(word)?|otp|secret|token|note|risk|score|signal|admin|phone|mobile|whatsapp|e-?mail|address|contact|cnic|income|religion|hidden|private|internal/i;

// Template-engine / injection syntax that has no legitimate use in a plain message body.
const INJECTION_SYNTAX = /\{\{\{|\{%|%\}|\$\{|<%|%>|\{\{\s*[#/>!&^.]|__proto__|constructor|prototype|<\s*script|javascript\s*:|data\s*:text\/html|on[a-z]{3,}\s*=/i;

const VARIABLE_TOKEN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const ANY_BRACES = /\{\{|\}\}/;
const MAX_VALUE_LENGTH = 120;

export class TemplateRenderError extends Error {
  constructor(
    public code: "UNKNOWN_VARIABLE" | "FORBIDDEN_VARIABLE" | "INJECTION" | "MISSING_VALUE" | "BAD_URL" | "PROTECTED_DATA" | "EMPTY",
    message: string
  ) {
    super(message);
    this.name = "TemplateRenderError";
  }
}

export function extractVariables(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(VARIABLE_TOKEN)) found.add(m[1]);
  return [...found];
}

// Validates template TEXT (subject/body) without values: used when a template is created, edited or submitted.
export function validateTemplateText(text: string, allowed: readonly string[]): { ok: true; variables: string[] } | { ok: false; code: TemplateRenderError["code"]; message: string } {
  if (INJECTION_SYNTAX.test(text)) return { ok: false, code: "INJECTION", message: "The template contains markup or template syntax that is not allowed." };
  const variables = extractVariables(text);
  for (const name of variables) {
    if (FORBIDDEN_VARIABLE.test(name)) return { ok: false, code: "FORBIDDEN_VARIABLE", message: `The variable {{${name}}} is not allowed in any template.` };
    if (!allowed.includes(name)) return { ok: false, code: "UNKNOWN_VARIABLE", message: `The variable {{${name}}} is not on the allow-list.` };
  }
  // Any leftover brace pair that is not a well-formed variable is suspicious (e.g. "{{ a.b }}", "{{a b}}").
  const stripped = text.replace(VARIABLE_TOKEN, "");
  if (ANY_BRACES.test(stripped)) return { ok: false, code: "INJECTION", message: "Malformed template variable syntax." };
  return { ok: true, variables };
}

export function sanitizeValue(value: string): string {
  // Remove control characters (blocks header / log injection) and collapse whitespace; cap the length.
  let out = "";
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    out += code < 32 || code === 127 ? " " : ch;
  }
  return out.replace(/\s+/g, " ").trim().slice(0, MAX_VALUE_LENGTH);
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ---------- URLs (SSRF + phishing hardening) ----------

const PRIVATE_HOST =
  /^(localhost|.*\.localhost|.*\.local|.*\.internal|metadata\.google\.internal|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:)/i;

export function allowedUrlHosts(env: Record<string, string | undefined> = process.env): string[] {
  const hosts = new Set<string>();
  for (const raw of [env.APP_BASE_URL, env.NEXT_PUBLIC_APP_URL, env.NEXTAUTH_URL, env.VERCEL_PROJECT_PRODUCTION_URL]) {
    if (!raw) continue;
    try {
      hosts.add(new URL(raw.startsWith("http") ? raw : `https://${raw}`).hostname.toLowerCase());
    } catch {
      // ignore malformed config
    }
  }
  for (const extra of (env.COMMUNICATION_ALLOWED_URL_HOSTS ?? "").split(",")) if (extra.trim()) hosts.add(extra.trim().toLowerCase());
  return [...hosts];
}

export function sanitizeUrl(raw: string, hosts: readonly string[] = allowedUrlHosts()): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null; // credentials-in-URL phishing trick
  const host = url.hostname.toLowerCase();
  if (PRIVATE_HOST.test(host) || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null; // never an IP literal or private name
  if (!hosts.includes(host)) return null;
  return url.toString();
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"')]+/gi;

export function findUrls(text: string): string[] {
  return text.match(URL_IN_TEXT) ?? [];
}

// ---------- protected strings (contact-leak guard) ----------

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

export function containsProtectedString(text: string, protectedStrings: readonly (string | null | undefined)[]): boolean {
  const lower = text.toLowerCase();
  const textDigits = digitsOnly(text);
  for (const raw of protectedStrings) {
    const p = (raw ?? "").trim();
    if (p.length < 4) continue;
    if (lower.includes(p.toLowerCase())) return true;
    const d = digitsOnly(p);
    if (d.length >= 7 && textDigits.includes(d)) return true; // phone written with different spacing / separators
  }
  return false;
}

// ---------- rendering ----------

export interface RenderInput {
  subject?: string | null;
  body: string;
  values: Partial<Record<string, string | null | undefined>>;
  allowed?: readonly string[];
  hosts?: readonly string[];
  protectedStrings?: readonly (string | null | undefined)[];
}

export interface RenderedMessage {
  subject: string | null;
  text: string;
  html: string;
  usedVariables: string[];
}

export function renderTemplate(input: RenderInput): RenderedMessage {
  const allowed = input.allowed ?? COMMUNICATION_VARIABLES;
  const parts = [input.subject ?? "", input.body];
  for (const part of parts) {
    const check = validateTemplateText(part, allowed);
    if (!check.ok) throw new TemplateRenderError(check.code, check.message);
  }
  const used = new Set<string>();
  const sub = (text: string) =>
    text.replace(VARIABLE_TOKEN, (_m, name: string) => {
      const raw = input.values[name];
      if (raw === undefined || raw === null || raw === "") throw new TemplateRenderError("MISSING_VALUE", `No value is available for {{${name}}}.`);
      used.add(name);
      return sanitizeValue(String(raw));
    });

  const subject = input.subject ? sub(input.subject) : null;
  const text = sub(input.body);
  if (text.trim().length === 0) throw new TemplateRenderError("EMPTY", "The rendered message is empty.");

  // Every URL in the final text must be an allow-listed https URL.
  const hosts = input.hosts ?? allowedUrlHosts();
  for (const url of findUrls(text)) {
    if (!sanitizeUrl(url, hosts)) throw new TemplateRenderError("BAD_URL", "A link in the message is not on the allow-list.");
  }
  if (containsProtectedString(text, input.protectedStrings ?? []) || (subject && containsProtectedString(subject, input.protectedStrings ?? []))) {
    throw new TemplateRenderError("PROTECTED_DATA", "The message would disclose protected contact details.");
  }
  return { subject, text, html: toHtmlEmail(text), usedVariables: [...used] };
}

// Responsive, table-free minimal HTML: everything is escaped first; only allow-listed https URLs become links.
export function toHtmlEmail(text: string, opts: { footer?: string } = {}): string {
  const hosts = allowedUrlHosts();
  const escaped = escapeHtml(text).replace(/https:\/\/[^\s<]+/g, (raw) => {
    const clean = raw.replace(/&amp;/g, "&");
    const safe = sanitizeUrl(clean, hosts);
    return safe ? `<a href="${escapeHtml(safe)}">${escapeHtml(safe)}</a>` : raw;
  });
  const body = escaped.split("\n\n").map((p) => `<p style="margin:0 0 14px">${p.split("\n").join("<br>")}</p>`).join("");
  const footer = opts.footer ? `<p style="margin:24px 0 0;font-size:12px;color:#6b7280">${escapeHtml(opts.footer)}</p>` : "";
  return `<div style="max-width:560px;margin:0 auto;padding:16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111827">${body}${footer}</div>`;
}
