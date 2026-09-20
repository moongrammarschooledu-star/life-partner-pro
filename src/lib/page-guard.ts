import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import type { Permission } from "@/lib/permissions";

// Server-side permission gate for admin pages: redirects instead of rendering
// a shell the caller may not use. The corresponding APIs enforce the same
// permission independently (requireAdmin), so this is UX, not the control.
export async function requirePagePermission(permission: Permission) {
  const session = await auth();
  if (!session?.user) redirect("/admin/login");
  if (!session.user.permissions.includes(permission)) redirect("/admin/dashboard");
  return session.user;
}
