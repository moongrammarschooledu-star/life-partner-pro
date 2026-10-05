// Same-origin check for the public marketing POST routes. The app has no CSRF layer for public routes (cookies are
// SameSite=Lax and these routes use none), so a browser submission must come from this site: the Origin header's host
// has to equal the request host. A missing Origin is rejected too — browsers always send it on a cross-site or JSON
// POST — which also filters simplistic scripts (it is not a substitute for the token, honeypot and rate limits).
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim().toLowerCase();
  return !!host && originHost === host;
}
