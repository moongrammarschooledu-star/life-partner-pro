import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { authConfig } from "@/lib/auth.config";
import type { AdminRole } from "@/lib/permissions";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;

        const admin = await prisma.adminUser.findUnique({ where: { email: email.toLowerCase() } });
        if (!admin || !admin.active) return null;

        const valid = await bcrypt.compare(password, admin.passwordHash);
        if (!valid) return null;

        await prisma.auditLog.create({
          data: { adminId: admin.id, action: "ADMIN_LOGIN" },
        });

        return {
          id: admin.id,
          name: admin.name,
          email: admin.email,
          role: admin.role as AdminRole,
        };
      },
    }),
  ],
});

export async function getSessionAdmin() {
  const session = await auth();
  return session?.user ?? null;
}
