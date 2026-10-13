// App version policy (STEP 37 §32). Pure.
//
//   minimumSupportedVersion  below this the app must be updated before it can be used
//   recommendedVersion       below this the app is told an update is available
//   latestVersion            the newest released version (informational)
//
// Versions are dotted numbers only ("1.2.0", up to four parts). Anything else is refused rather than guessed, so a manipulated or malformed version
// string cannot be read as "new enough".

export type UpdateStatus = "OK" | "UPDATE_RECOMMENDED" | "UPDATE_REQUIRED";

const VERSION = /^\d{1,5}(\.\d{1,5}){0,3}$/;

export function isValidVersion(v: unknown): v is string {
  return typeof v === "string" && VERSION.test(v);
}

export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export interface VersionPolicy {
  minimumSupportedVersion: string;
  recommendedVersion: string;
  latestVersion: string;
}

export const DEFAULT_POLICY: VersionPolicy = { minimumSupportedVersion: "1.0.0", recommendedVersion: "1.0.0", latestVersion: "1.0.0" };

/** A policy must be internally consistent: minimum <= recommended <= latest. Returns a message, or null when valid. */
export function policyProblem(p: VersionPolicy): string | null {
  for (const [k, v] of Object.entries(p)) if (!isValidVersion(v)) return `${k} must be a dotted number such as 1.2.0.`;
  if (compareVersions(p.minimumSupportedVersion, p.recommendedVersion) > 0) return "The minimum supported version cannot be higher than the recommended version.";
  if (compareVersions(p.recommendedVersion, p.latestVersion) > 0) return "The recommended version cannot be higher than the latest version.";
  return null;
}

/** An unknown or malformed client version is treated as the OLDEST possible one: it must not be able to dodge a required update by lying. */
export function evaluateVersion(clientVersion: unknown, policy: VersionPolicy): UpdateStatus {
  if (!isValidVersion(clientVersion)) return "UPDATE_REQUIRED";
  if (compareVersions(clientVersion, policy.minimumSupportedVersion) < 0) return "UPDATE_REQUIRED";
  if (compareVersions(clientVersion, policy.recommendedVersion) < 0) return "UPDATE_RECOMMENDED";
  return "OK";
}

/** Only the official store listings may be offered as the place to update; anything else is dropped. */
export function safeStoreUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "https:" || u.username || u.password) return null;
    if (u.hostname === "play.google.com" || u.hostname === "apps.apple.com") return u.toString();
    return null;
  } catch {
    return null;
  }
}

/** Reads "LPPApp/1.2.3 (android)" from the user agent the apps add to the web view. */
export function parseAppUserAgent(ua: string | null | undefined): { version: string; platform: "ANDROID" | "IOS" } | null {
  const m = /LPPApp\/(\d{1,5}(?:\.\d{1,5}){0,3}) \((android|ios)\)/i.exec(ua ?? "");
  if (!m) return null;
  return { version: m[1], platform: m[2].toLowerCase() === "android" ? "ANDROID" : "IOS" };
}