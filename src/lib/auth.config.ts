import type { NextAuthConfig } from "next-auth";
import type { AdminRole, Permission } from "@/lib/permissions";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      role: AdminRole;
      permissions: Permission[];
      sid: string;
      mustResetPassword: boolean;
    };
  }
  interface User {
    role: AdminRole;
    permissions: Permission[];
    sid: string;
    mustResetPassword: boolean;
  }
}

// Edge-safe subset of the NextAuth config — no providers, so nothing here
// pulls in bcrypt or the Prisma client. middleware.ts builds a NextAuth
// instance from just this file; the full instance with the Credentials
// provider lives in auth.ts and is only ever used in Node.js route handlers.
// Splitting these is required because Vercel's Edge Middleware has a 1MB
// bundle limit, and bcrypt + @prisma/client alone blow past it.
export const authConfig = {
  session: { strategy: "jwt" },
  pages: { signIn: "/admin/login" },
  providers: [],
  callbacks: {
    jwt: ({ token, user }) => {
      if (user) {
        token.id = user.id as string;
        token.role = (user as { role: AdminRole }).role;
        token.permissions = (user as { permissions: Permission[] }).permissions;
        token.sid = (user as { sid: string }).sid;
        token.mustResetPassword = (user as { mustResetPassword: boolean }).mustResetPassword;
      }
      return token;
    },
    session: ({ session, token }) => {
      session.user.id = token.id as string;
      session.user.role = token.role as AdminRole;
      session.user.permissions = (token.permissions as Permission[]) ?? [];
      session.user.sid = token.sid as string;
      session.user.mustResetPassword = (token.mustResetPassword as boolean) ?? false;
      return session;
    },
  },
} satisfies NextAuthConfig;
