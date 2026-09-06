import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth.config";

// A separate, minimal NextAuth instance built only from the edge-safe
// config (no providers) — this is what keeps bcrypt and @prisma/client out
// of the Edge Middleware bundle. See auth.config.ts for why.
const { auth } = NextAuth(authConfig);

// Defense-in-depth layer #1. Every admin API route also re-checks the
// session + role server-side (see src/lib/route-guard.ts) since middleware
// alone is not sufficient for authorization decisions.
// Pre-authentication login-flow endpoints — called from the login page
// before any session exists (spec §12's 2FA precheck/verify-otp step), so
// they must stay reachable without req.auth. Every other /api/admin/* route
// still requires a session here, and requireAdmin() re-checks permissions
// server-side regardless (see src/lib/route-guard.ts).
const PUBLIC_ADMIN_API_PATHS = ["/api/admin/auth/precheck", "/api/admin/auth/verify-otp"];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isAdminArea = pathname.startsWith("/admin") && pathname !== "/admin/login";
  const isAdminApi = pathname.startsWith("/api/admin") && !PUBLIC_ADMIN_API_PATHS.includes(pathname);

  if ((isAdminArea || isAdminApi) && !req.auth) {
    if (isAdminApi) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/admin/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }
});

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
