import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission, type Permission, type AdminRole } from "@/lib/permissions";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Re-checks session + permission server-side for every admin API route.
 * Middleware only blocks unauthenticated requests; this enforces the actual
 * role-based permission for the specific action being performed.
 */
export async function requireAdmin(permission?: Permission) {
  const session = await auth();
  if (!session?.user) {
    throw new ApiError(401, "Unauthorized");
  }
  if (permission && !hasPermission(session.user.role as AdminRole, permission)) {
    throw new ApiError(403, "Forbidden: insufficient permissions");
  }
  return session.user;
}

export function handleApiError(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(error);
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}
