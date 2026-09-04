import type { NextAuthConfig } from "next-auth";
import type { AdminRole } from "@/lib/permissions";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      role: AdminRole;
    };
  }
  interface User {
    role: AdminRole;
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
      }
      return token;
    },
    session: ({ session, token }) => {
      session.user.id = token.id as string;
      session.user.role = token.role as AdminRole;
      return session;
    },
  },
} satisfies NextAuthConfig;
