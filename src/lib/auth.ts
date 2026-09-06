import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import { authConfig } from "@/lib/auth.config";
import { checkAdminCredentials } from "@/lib/admin-login";
import { resolveEffectivePermissions } from "@/lib/effective-permissions";
import { verifyStepUpToken } from "@/lib/step-up-token";
import { writeAudit } from "@/lib/audit";
import type { AdminRole } from "@/lib/permissions";

// Session duration: NextAuth's JWT maxAge (30-day default, unset here) is
// fixed at Edge config construction time in auth.config.ts and can't do a DB
// read there without breaking the Edge/Node split that keeps middleware
// under Vercel's bundle limit — see that file's own header comment.
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        otpToken: { label: "OTP Token", type: "text" },
      },
      authorize: async (credentials, request) => {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        const otpToken = (credentials?.otpToken as string | undefined) || undefined;
        if (!email || !password) return null;

        const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
        const userAgent = request.headers.get("user-agent");

        // Independently re-verified here (not trusting the client's
        // "precheck already passed" claim) — this is the only place a
        // session is ever actually minted, so it must be self-sufficient.
        const result = await checkAdminCredentials({ email, password, ipAddress, userAgent });
        if (!result.ok) return null;
        const { admin } = result;

        if (result.twoFactorRequired) {
          const valid = verifyStepUpToken(otpToken, "LOGIN_2FA", email.toLowerCase());
          if (!valid) {
            await prisma.adminLoginHistory.create({
              data: { adminId: admin.id, email: admin.email, event: "FAILURE", ipAddress, userAgent },
            });
            return null;
          }
        }

        const session = await prisma.adminSession.create({
          data: {
            adminId: admin.id,
            userAgent,
            ipAddress,
            deviceInfo: userAgent ? summarizeUserAgent(userAgent) : null,
            expiresAt: new Date(Date.now() + SESSION_MAX_AGE_MS),
          },
        });
        const sid = session.id;
        await prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
        await prisma.adminLoginHistory.create({
          data: { adminId: admin.id, email: admin.email, event: "SUCCESS", ipAddress, userAgent },
        });
        await writeAudit({ action: "ADMIN_LOGIN", adminId: admin.id });

        const permissions = await resolveEffectivePermissions({ role: admin.role as AdminRole, customRoleId: admin.customRoleId });

        return {
          id: admin.id,
          name: admin.name,
          email: admin.email,
          role: admin.role as AdminRole,
          permissions,
          sid,
          mustResetPassword: admin.mustResetPassword,
        };
      },
    }),
  ],
});

// A short, human-readable device summary for the Active Sessions list — not
// a full UA-parser dependency, just enough to tell two sessions apart.
function summarizeUserAgent(ua: string): string {
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Unknown browser";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "Unknown OS";
  return `${browser} on ${os}`;
}

export async function getSessionAdmin() {
  const session = await auth();
  return session?.user ?? null;
}
