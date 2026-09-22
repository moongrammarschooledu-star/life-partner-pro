import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { ensurePermissionDefsSeeded } from "@/lib/permission-defs";
import { ADMIN_ROLES, type AdminRole, type Permission } from "@/lib/permissions";
import { assertCanGrantPermissions } from "@/lib/role-management";
import { ACCESS_LEVELS, type AccessLevel } from "@/lib/access-level";
import type { AssignmentResourceType } from "@prisma/client";

const RESOURCE_TYPES: AssignmentResourceType[] = ["PROPOSAL", "VERIFICATION", "SECURITY_FLAG", "FOLLOW_UP", "PROFILE", "CASE"];

export async function GET() {
  try {
    await requireAdmin("admin:manage");
    await ensurePermissionDefsSeeded();

    const [roles, permissionDefs] = await Promise.all([
      prisma.customRole.findMany({
        include: { permissions: { select: { permissionKey: true } } },
        orderBy: { name: "asc" },
      }),
      prisma.permissionDef.findMany({ orderBy: [{ module: "asc" }, { action: "asc" }] }),
    ]);

    return NextResponse.json({
      roles: roles.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        baseRole: r.baseRole,
        active: r.active,
        permissions: r.permissions.map((p) => p.permissionKey),
        allowedRecordTypes: r.allowedRecordTypes,
        defaultAccessLevel: r.defaultAccessLevel,
      })),
      permissionDefs,
      baseRoles: ADMIN_ROLES,
      resourceTypes: RESOURCE_TYPES,
      accessLevels: ACCESS_LEVELS,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// Custom roles are additive on top of the 13 system roles (STEP 17 §42) —
// `baseRole` picks which of those 13 row-scoping *shapes* (broad vs
// assignment-scoped) this custom role uses; its actual permission set is the
// explicit list below, not inherited from baseRole.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("admin:manage", { allowViewAs: false });
    if (!admin.permissions.includes("roles:create")) throw new ApiError(403, "You do not have permission to create roles.");

    const { name, description, baseRole, permissions, allowedRecordTypes, defaultAccessLevel } = (await req.json()) as {
      name?: string;
      description?: string;
      baseRole?: string;
      permissions?: string[];
      allowedRecordTypes?: AssignmentResourceType[];
      defaultAccessLevel?: AccessLevel;
    };

    if (!name?.trim()) throw new ApiError(400, "Name is required.");
    if (!baseRole || !ADMIN_ROLES.includes(baseRole as AdminRole)) throw new ApiError(400, "baseRole must be one of the assignable admin roles.");
    if (allowedRecordTypes?.some((t) => !RESOURCE_TYPES.includes(t))) throw new ApiError(400, "Invalid record type in allowedRecordTypes.");
    if (defaultAccessLevel && !ACCESS_LEVELS.includes(defaultAccessLevel)) throw new ApiError(400, "Invalid defaultAccessLevel.");

    // STEP 17 §39/§41/§42 — a custom role can never be created with permissions
    // the creator does not hold themselves.
    await assertCanGrantPermissions(admin, (permissions ?? []) as Permission[]);

    const role = await prisma.customRole.create({
      data: {
        name: name.trim(),
        description: description || null,
        baseRole: baseRole as AdminRole,
        allowedRecordTypes: allowedRecordTypes ?? [],
        defaultAccessLevel: defaultAccessLevel ?? null,
        permissions: {
          create: (permissions ?? []).map((key) => ({ permissionKey: key })),
        },
      },
    });

    await writeAudit({ action: "CUSTOM_ROLE_CREATED", adminId: admin.id, meta: { roleId: role.id, name: role.name, baseRole: role.baseRole } });

    return NextResponse.json(role);
  } catch (error) {
    return handleApiError(error);
  }
}
