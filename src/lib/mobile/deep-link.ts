// Deep links (STEP 37 §14–§16). Pure part: decide whether a link is one the app may open, and normalise it to a path.
//
// A deep link is only ever a ROUTE, never proof of anything: the page it opens re-checks the signed-in person, and for a record the server first confirms the
// record belongs to that person (see resolve in deep-link-service.ts). Links carrying secrets (token, password, key, code in the query) are refused outright,
// and the query string is dropped entirely: the app opens a path, nothing else.

export type LinkAudience = "PROFILE" | "FAMILY";

export interface LinkPattern {
  /** Exact path, or a prefix ending in "/:id" which stands for one path segment. */
  pattern: string;
  audience: LinkAudience;
  /** Detail routes name a record; the server verifies ownership before the app opens it. */
  record?: "PROPOSAL";
}

// Only routes that exist in the application are listed. The brief's /proposals/{id} and /meetings/{id} are the application's /dashboard/proposals/{code}
// and /my-proposals; meetings live inside the proposal pages.
export const ALLOWED_LINKS: LinkPattern[] = [
  { pattern: "/dashboard", audience: "PROFILE" },
  { pattern: "/dashboard/proposals/:id", audience: "PROFILE", record: "PROPOSAL" },
  { pattern: "/dashboard/notifications", audience: "PROFILE" },
  { pattern: "/dashboard/documents", audience: "PROFILE" },
  { pattern: "/dashboard/membership", audience: "PROFILE" },
  { pattern: "/dashboard/profile/edit", audience: "PROFILE" },
  { pattern: "/dashboard/journey", audience: "PROFILE" },
  { pattern: "/dashboard/referrals", audience: "PROFILE" },
  { pattern: "/dashboard/feedback", audience: "PROFILE" },
  { pattern: "/dashboard/settings/notifications", audience: "PROFILE" },
  { pattern: "/my-proposals", audience: "PROFILE" },
  { pattern: "/my-verification", audience: "PROFILE" },
  { pattern: "/my-status", audience: "PROFILE" },
  { pattern: "/my-notifications", audience: "PROFILE" },
  { pattern: "/account-settings", audience: "PROFILE" },
  { pattern: "/report-concern", audience: "PROFILE" },
  { pattern: "/family/dashboard", audience: "FAMILY" },
  { pattern: "/family/proposals", audience: "FAMILY" },
  { pattern: "/family/meetings", audience: "FAMILY" },
  { pattern: "/family/documents", audience: "FAMILY" },
  { pattern: "/family/communications", audience: "FAMILY" },
  { pattern: "/family/security", audience: "FAMILY" },
];

const SECRET_KEY = /(token|secret|password|passwd|pwd|key|otp|code|auth|session|mobile|phone|email)/i;

export type ParsedLink =
  | { ok: true; path: string; pattern: LinkPattern; id?: string }
  | { ok: false; reason: "INVALID" | "HOST" | "SECRET_IN_URL" | "NOT_ALLOWED" };

/** `appHosts` are the hosts of this site (lower case, with port when not default). A relative path is accepted; an absolute URL must use https and one of those hosts. */
export function parseDeepLink(input: unknown, appHosts: readonly string[]): ParsedLink {
  if (typeof input !== "string") return { ok: false, reason: "INVALID" };
  const raw = input.trim();
  if (!raw || raw.length > 300 || /[\u0000-\u001f\u007f\\]/.test(raw)) return { ok: false, reason: "INVALID" };

  let url: URL;
  try {
    if (raw.startsWith("/") && !raw.startsWith("//")) url = new URL(raw, "https://placeholder.invalid");
    else {
      url = new URL(raw);
      if (url.protocol !== "https:" || url.username || url.password) return { ok: false, reason: "HOST" };
      if (!appHosts.includes(url.host.toLowerCase())) return { ok: false, reason: "HOST" };
    }
  } catch {
    return { ok: false, reason: "INVALID" };
  }

  for (const [k, v] of url.searchParams) if (SECRET_KEY.test(k) || /^[A-Za-z0-9_-]{32,}$/.test(v)) return { ok: false, reason: "SECRET_IN_URL" };

  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return { ok: false, reason: "INVALID" };
  }
  // A decoded path must not smuggle in traversal, a second slash or a different shape than the one that was matched.
  if (path.includes("..") || path.includes("//") || /[^!-~]/.test(path)) return { ok: false, reason: "INVALID" };
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);

  for (const p of ALLOWED_LINKS) {
    if (!p.pattern.endsWith("/:id")) {
      if (path === p.pattern) return { ok: true, path, pattern: p };
      continue;
    }
    const prefix = p.pattern.slice(0, -3);
    if (path.startsWith(prefix)) {
      const id = path.slice(prefix.length);
      if (/^[A-Za-z0-9_-]{3,40}$/.test(id)) return { ok: true, path, pattern: p, id };
    }
  }
  return { ok: false, reason: "NOT_ALLOWED" };
}

/** The route paths the platform-specific association files may list (Android App Links and iOS Universal Links). Prefixes only; never a secret or an id. */
export function associatedPathPatterns(): string[] {
  const set = new Set<string>();
  for (const p of ALLOWED_LINKS) set.add(p.pattern.endsWith("/:id") ? `${p.pattern.slice(0, -3)}*` : p.pattern);
  return [...set];
}