import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { resolveEffectivePermissions } from "@/lib/effective-permissions";
import type { AdminRole, Permission } from "@/lib/permissions";

export const VIEW_AS_COOKIE = "lpp_view_as";
export const VIEW_AS_DURATION_MS = 15 * 60_000;

export interface ViewAsIdentity {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  permissions: Permission[];
  viewAsSessionId: string;
  viewAsBy: string;
  expiresAt: Date;
}

// Read-only support impersonation (spec §18). Only resolved when a route
// explicitly opts in via requireAdmin(permission, {allowViewAs:true}) — see
// route-guard.ts for why this is opt-in rather than a method-sniffed
// blocklist. Returns null whenever there's no active, valid grant for the
// CURRENT real admin (a cookie can't be reused by a different account).
export async function getActiveViewAs(realAdminId: string): Promise<ViewAsIdentity | null> {
  const store = await cookies();
  const sessionId = store.get(VIEW_AS_COOKIE)?.value;
  if (!sessionId) return null;

  const grant = await prisma.viewAsSession.findUnique({
    where: { id: sessionId },
    include: { targetAdmin: true },
  });
  if (!grant) return null;
  if (grant.superAdminId !== realAdminId) return null;
  if (grant.endedAt) return null;
  if (grant.expiresAt.getTime() < Date.now()) return null;

  const target = grant.targetAdmin;
  const permissions = await resolveEffectivePermissions({ role: target.role as AdminRole, customRoleId: target.customRoleId });

  return {
    id: target.id,
    name: target.name,
    email: target.email,
    role: target.role as AdminRole,
    permissions,
    viewAsSessionId: grant.id,
    viewAsBy: realAdminId,
    expiresAt: grant.expiresAt,
  };
}
