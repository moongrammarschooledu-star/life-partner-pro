// Identifiers and addresses of the mobile apps (STEP 37 §3). Everything comes from deployment configuration so an already-published identifier is never
// hard-coded here; the defaults are only the documented starting values for a first release.

export const DEFAULT_ANDROID_PACKAGE_ID = "com.lifepartnerpro.app";
export const DEFAULT_IOS_BUNDLE_ID = "com.lifepartnerpro.app";
export const APP_DISPLAY_NAME = "Life Partner Pro";

type EnvMap = Record<string, string | undefined>;

const clean = (v: string | undefined) => (v ?? "").trim();

export interface MobileIdentity {
  appName: string;
  androidPackageId: string;
  iosBundleId: string;
  /** Hosts whose pages the apps may show inside the app (the canonical site host, plus any extra listed in MOBILE_ALLOWED_HOSTS). */
  appHosts: string[];
  appUrl: string;
}

const PACKAGE_ID = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

export function mobileIdentity(env: EnvMap = process.env): MobileIdentity {
  const appUrl = clean(env.NEXT_PUBLIC_APP_URL) || clean(env.APP_URL) || "https://lifepartnerpro.vercel.app";
  const hosts = new Set<string>();
  try {
    hosts.add(new URL(appUrl).host.toLowerCase());
  } catch {
    /* an unusable URL simply contributes no host */
  }
  for (const h of clean(env.MOBILE_ALLOWED_HOSTS).split(",")) {
    const host = h.trim().toLowerCase();
    if (/^[a-z0-9.-]+(:\d+)?$/.test(host)) hosts.add(host);
  }
  const android = clean(env.ANDROID_PACKAGE_ID);
  const ios = clean(env.IOS_BUNDLE_ID);
  return {
    appName: APP_DISPLAY_NAME,
    androidPackageId: PACKAGE_ID.test(android) ? android : DEFAULT_ANDROID_PACKAGE_ID,
    iosBundleId: PACKAGE_ID.test(ios) ? ios : DEFAULT_IOS_BUNDLE_ID,
    appHosts: [...hosts],
    appUrl,
  };
}

/** SHA-256 certificate fingerprints of the Android signing keys (upload key and Play App Signing key), e.g. "AB:CD:…". Public information. */
export function androidCertFingerprints(env: EnvMap = process.env): string[] {
  return clean(env.ANDROID_SHA256_CERT_FINGERPRINTS)
    .split(",")
    .map((f) => f.trim().toUpperCase())
    .filter((f) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f));
}

/** Apple Developer Team ID (10 characters). Public information. */
export function appleTeamId(env: EnvMap = process.env): string | null {
  const t = clean(env.APPLE_TEAM_ID || env.APNS_TEAM_ID).toUpperCase();
  return /^[A-Z0-9]{10}$/.test(t) ? t : null;
}