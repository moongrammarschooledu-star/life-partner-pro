import { prisma } from "@/lib/prisma";
import { ROLE_PERMISSIONS, type AdminRole, type Permission } from "@/lib/permissions";

// Resolved once at login and embedded in the JWT (src/lib/auth.ts) — never
// re-derived per-request, matching the same staleness profile `role` already
// has in this codebase (a permission change takes effect on next login).
export async function resolveEffectivePermissions(admin: {
  role: AdminRole;
  customRoleId: string | null;
}): Promise<Permission[]> {
  if (!admin.customRoleId) {
    return ROLE_PERMISSIONS[admin.role] ?? [];
  }
  const rows = await prisma.customRolePermission.findMany({
    where: { customRoleId: admin.customRoleId },
    select: { permissionKey: true },
  });
  return rows.map((r) => r.permissionKey as Permission);
}
