import NextAuth from "next-auth";
import { NextResponse, type NextRequest } from "next/server";
import { authConfig } from "@/lib/auth.config";
import { isExemptFromMaintenance } from "@/lib/ops/system-state";

// Renamed from middleware.ts (deprecated in Next 16; Proxy runs on Node.js).
//
// A separate, minimal NextAuth instance built only from the edge-safe config
// (no providers) — keeps bcrypt and @prisma/client out of this bundle. See
// auth.config.ts for why.
const { auth } = NextAuth(authConfig);

// Pre-authentication login-flow endpoints — called from the login page
// before any session exists (spec §12's 2FA precheck/verify-otp step), so
// they must stay reachable without req.auth. Every other /api/admin/* route
// still requires a session here, and requireAdmin() re-checks permissions
// server-side regardless (see src/lib/route-guard.ts).
const PUBLIC_ADMIN_API_PATHS = ["/api/admin/auth/precheck", "/api/admin/auth/verify-otp"];

// ---- Correlation IDs (STEP 15 §15) ---------------------------------------
function correlate(req: NextRequest): { cid: string; requestHeaders: Headers } {
  // A caller-supplied ID is accepted only if it is a safe token (prevents log injection).
  const supplied = req.headers.get("x-correlation-id");
  const cid = supplied && /^[A-Za-z0-9-]{8,64}$/.test(supplied) ? supplied : crypto.randomUUID();
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-correlation-id", cid);
  requestHeaders.set("x-lpp-path", req.nextUrl.pathname);
  return { cid, requestHeaders };
}

function passThrough(req: NextRequest): NextResponse {
  const { cid, requestHeaders } = correlate(req);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("x-correlation-id", cid);
  return res;
}

// Defense-in-depth layer #1 for the admin area. Every admin API route also
// re-checks the session + role server-side (route-guard.ts).
const adminAuth = auth((req) => {
  const { pathname } = req.nextUrl;
  const isAdminArea = pathname.startsWith("/admin") && pathname !== "/admin/login";
  const isAdminApi = pathname.startsWith("/api/admin") && !PUBLIC_ADMIN_API_PATHS.includes(pathname);

  if ((isAdminArea || isAdminApi) && !req.auth) {
    if (isAdminApi) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "x-correlation-id": correlate(req).cid } });
    }
    const loginUrl = new URL("/admin/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }
  return passThrough(req);
});

// ---- Maintenance / emergency enforcement (STEP 15 §27/§56) ---------------
// Reads the public system state through a tiny endpoint with a 15 s
// per-instance cache. Fails OPEN on any error/timeout: a proxy problem must
// never turn into a self-inflicted outage.
let stateCache: { blocked: boolean; message: string; at: number } | null = null;

async function isPublicTrafficBlocked(origin: string): Promise<{ blocked: boolean; message: string }> {
  if (stateCache && Date.now() - stateCache.at < 15_000) return stateCache;
  try {
    const res = await fetch(`${origin}/api/system-state`, { cache: "no-store", signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      const json = (await res.json()) as { blocked?: boolean; message?: string };
      stateCache = { blocked: Boolean(json.blocked), message: json.message ?? "", at: Date.now() };
      return stateCache;
    }
  } catch {
    // fall through to stale/open
  }
  return stateCache ?? { blocked: false, message: "" };
}

export default async function proxy(req: NextRequest, evt: Parameters<typeof adminAuth>[1]) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    return adminAuth(req, evt);
  }

  if (!isExemptFromMaintenance(pathname)) {
    const state = await isPublicTrafficBlocked(req.nextUrl.origin);
    if (state.blocked) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: state.message || "The service is temporarily unavailable. Please try again later." }, { status: 503, headers: { "Retry-After": "300" } });
      }
      const rewrite = NextResponse.rewrite(new URL("/maintenance", req.url), { status: 503 });
      rewrite.headers.set("Retry-After", "300");
      return rewrite;
    }
  }

  return passThrough(req);
}

export const config = {
  // Everything except static assets — the maintenance check and correlation
  // IDs must cover public pages and public/applicant APIs too.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|map|txt|xml)$).*)"],
};
