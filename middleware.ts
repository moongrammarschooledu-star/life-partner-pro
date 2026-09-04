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
export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isAdminArea = pathname.startsWith("/admin") && pathname !== "/admin/login";
  const isAdminApi = pathname.startsWith("/api/admin");

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
