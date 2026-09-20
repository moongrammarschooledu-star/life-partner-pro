import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AdminShell } from "@/components/admin/admin-shell";
import { isAdminSessionUsable } from "@/lib/admin-session-state";

export default async function AdminShellLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/admin/login");

  // STEP 15 §21 — the JWT alone is not enough: the server-side session row is
  // authoritative (it carries the configurable expiry and can be revoked).
  // Without this, an expired/revoked session still rendered the admin UI and
  // only failed on the first API call.
  const record = await prisma.adminSession.findUnique({ where: { id: session.user.sid }, select: { revokedAt: true, expiresAt: true } });
  if (!isAdminSessionUsable(record)) redirect("/admin/login");

  if (session.user.mustResetPassword) redirect("/admin/change-password");

  return <AdminShell user={session.user}>{children}</AdminShell>;
}
