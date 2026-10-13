import { AdminRole, type PlatformAnnouncementKind } from "@prisma/client";
import { looksLikeSecret } from "@/lib/platform/config-values";

// Rules for platform announcements and the public status page (STEP 36 §58–§59). Pure. A public notice may say WHAT is affected and WHEN; it must not carry
// internal detail: addresses, file paths, stack traces, connection strings, secrets, personal data or security-rule specifics.

export const ANNOUNCEMENT_KINDS = ["MAINTENANCE", "SECURITY_NOTICE", "SERVICE_INTERRUPTION", "PLATFORM_UPDATE"] as const satisfies readonly PlatformAnnouncementKind[];

export const FIXED_AUDIENCES = ["ALL", "APPLICANTS", "FAMILY", "ADMINS"] as const;

export function validateAudience(input: unknown): { ok: true; audience: string[] } | { ok: false; error: string } {
  if (!Array.isArray(input) || input.length === 0 || input.length > 10) return { ok: false, error: "Choose at least one audience (at most 10)." };
  const out = new Set<string>();
  for (const a of input) {
    if (typeof a !== "string") return { ok: false, error: "Invalid audience." };
    const v = a.trim().toUpperCase();
    if ((FIXED_AUDIENCES as readonly string[]).includes(v)) out.add(v);
    else if (v.startsWith("ROLE:") && (Object.values(AdminRole) as string[]).includes(v.slice(5))) out.add(v);
    else return { ok: false, error: `Unknown audience “${a.slice(0, 30)}”.` };
  }
  return { ok: true, audience: [...out] };
}

/** An audience that includes people outside the administrator team: the text will be read by the public, applicants or families. */
export function isPublicFacing(audience: readonly string[], showOnStatusPage: boolean): boolean {
  return showOnStatusPage || audience.some((a) => a === "ALL" || a === "APPLICANTS" || a === "FAMILY");
}

const INTERNAL_PATTERNS: Array<{ re: RegExp; what: string }> = [
  { re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/, what: "an IP address" },
  { re: /\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b/i, what: "an IP address" },
  { re: /(?:^|[\s(])\/(?:src|app|usr|var|etc|home|opt|tmp)\/[\w./-]+/, what: "a file path" },
  { re: /\b[A-Za-z]:\\[\w\\.-]+/, what: "a file path" },
  { re: /\bat\s+[\w$.<>]+\s*\(.*:\d+:\d+\)/, what: "a stack trace" },
  { re: /\b(?:Error|Exception):\s+\S+.*\n?\s+at\s/, what: "a stack trace" },
  { re: /\b[\w-]+\.(?:internal|local|corp|lan)\b/i, what: "an internal host name" },
  { re: /\bpostgres(?:ql)?:\/\//i, what: "a connection string" },
  { re: /\b(?:prisma|neon|vercel|supabase)\b.*\b(?:token|key|password)\b/i, what: "infrastructure credentials" },
  { re: /\b(?:firewall|rate[- ]?limit|detection rule|threshold|risk score|honeypot|waf)\b/i, what: "security-rule detail" },
];

/** Problems that make a text unsuitable for an audience outside the administrator team. Empty = fine. */
export function publicSafetyProblems(text: string): string[] {
  const problems: string[] = [];
  if (looksLikeSecret(text)) problems.push("what looks like a secret");
  for (const { re, what } of INTERNAL_PATTERNS) if (re.test(text)) problems.push(what);
  return [...new Set(problems)];
}

export type AnnouncementWindow = { startsAt: Date | null; endsAt: Date | null; status: string };

/** Published, and inside its window. */
export function isAnnouncementLive(a: AnnouncementWindow, now: Date = new Date()): boolean {
  if (a.status !== "PUBLISHED") return false;
  if (a.startsAt && a.startsAt.getTime() > now.getTime()) return false;
  if (a.endsAt && a.endsAt.getTime() <= now.getTime()) return false;
  return true;
}

export function audienceMatches(audience: readonly string[], who: { scope: "public" | "applicant" | "family" | "admin"; role?: string }): boolean {
  if (audience.includes("ALL")) return true;
  if (who.scope === "applicant") return audience.includes("APPLICANTS");
  if (who.scope === "family") return audience.includes("FAMILY");
  if (who.scope === "admin") return audience.includes("ADMINS") || (!!who.role && audience.includes(`ROLE:${who.role}`));
  return false;
}
