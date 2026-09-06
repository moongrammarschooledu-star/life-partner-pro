import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { getActiveViewAs } from "@/lib/view-as";
import type { Permission, AdminRole } from "@/lib/permissions";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface RequireAdminOptions {
  // Opt-in only (secure by default) — see src/lib/view-as.ts. Only a small,
  // deliberate set of read routes should ever pass this; every route added
  // without it is automatically incompatible with an active View-As grant.
  allowViewAs?: boolean;
}

export interface SessionAdmin {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  permissions: Permission[];
  viewAsBy?: string;
  sid: string;
}

/**
 * Re-checks session + permission server-side for every admin API route.
 * Middleware only blocks unauthenticated requests; this enforces the actual
 * role-based permission for the specific action being performed, the
 * session's revocation status, and (opt-in only) View-As resolution.
 */
export async function requireAdmin(permission?: Permission, options?: RequireAdminOptions): Promise<SessionAdmin> {
  const session = await auth();
  if (!session?.user) {
    throw new ApiError(401, "Unauthorized");
  }

  const record = await prisma.adminSession.findUnique({ where: { id: session.user.sid } });
  if (!record || record.revokedAt || record.expiresAt.getTime() < Date.now()) {
    throw new ApiError(401, "Session has been revoked or expired. Please sign in again.");
  }
  // Fire-and-forget-ish but awaited (small write, low traffic) — keeps
  // "last active" meaningful for the Active Sessions list.
  await prisma.adminSession.update({ where: { id: record.id }, data: { lastActiveAt: new Date() } }).catch(() => {});

  let effective: SessionAdmin = {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    role: session.user.role,
    permissions: session.user.permissions ?? [],
    sid: session.user.sid,
  };

  const viewAs = await getActiveViewAs(session.user.id);
  if (viewAs) {
    if (!options?.allowViewAs) {
      throw new ApiError(403, "This action is not available while viewing as another admin.");
    }
    effective = {
      id: viewAs.id,
      name: viewAs.name,
      email: viewAs.email,
      role: viewAs.role,
      permissions: viewAs.permissions,
      viewAsBy: viewAs.viewAsBy,
      sid: session.user.sid,
    };
    await writeAudit({ action: "VIEW_AS_ACCESS", adminId: viewAs.id, meta: { viewAsBy: viewAs.viewAsBy } });
  }

  if (permission && !effective.permissions.includes(permission)) {
    throw new ApiError(403, "Forbidden: insufficient permissions");
  }
  return effective;
}

export function handleApiError(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(error);
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}
