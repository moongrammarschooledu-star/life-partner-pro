// Hosts the marketing content policy treats as "our own" (links to anything else are blocked in reviewed content).
type EnvMap = Record<string, string | undefined>;

export function allowedMarketingHosts(env: EnvMap = process.env): string[] {
  const out = new Set<string>();
  for (const v of [env.APP_URL, env.APP_BASE_URL, env.NEXT_PUBLIC_APP_URL, env.NEXTAUTH_URL, env.VERCEL_PROJECT_PRODUCTION_URL]) {
    if (!v) continue;
    try {
      out.add(new URL(v.startsWith("http") ? v : `https://${v}`).hostname.toLowerCase());
    } catch {
      // ignore malformed env values
    }
  }
  return [...out];
}

// Canonical base URL for absolute links (canonical tags, sitemap). Null when none is configured.
export function marketingBaseUrl(env: EnvMap = process.env): string | null {
  const v = env.APP_URL ?? env.NEXT_PUBLIC_APP_URL ?? env.NEXTAUTH_URL ?? (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : null);
  if (!v) return null;
  try {
    const u = new URL(v.startsWith("http") ? v : `https://${v}`);
    return u.origin;
  } catch {
    return null;
  }
}
