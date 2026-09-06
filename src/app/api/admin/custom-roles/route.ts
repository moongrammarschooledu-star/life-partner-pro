import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { ensurePermissionDefsSeeded } from "@/lib/permission-defs";

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
      })),
      permissionDefs,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// Custom roles are additive on top of the 4 system roles (spec §3) — always
// STAFF- or VIEWER-shaped for row-scoping purposes, enforced here.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("admin:manage");
    const { name, description, baseRole, permissions } = (await req.json()) as {
      name?: string;
      description?: string;
      baseRole?: string;
      permissions?: string[];
    };

    if (!name?.trim()) throw new ApiError(400, "Name is required.");
    if (baseRole !== "STAFF" && baseRole !== "VIEWER") throw new ApiError(400, "baseRole must be STAFF or VIEWER.");

    const role = await prisma.customRole.create({
      data: {
        name: name.trim(),
        description: description || null,
        baseRole,
        permissions: {
          create: (permissions ?? []).map((key) => ({ permissionKey: key })),
        },
      },
    });

    await writeAudit({ action: "CUSTOM_ROLE_CREATED", adminId: admin.id, meta: { roleId: role.id, name: role.name } });

    return NextResponse.json(role);
  } catch (error) {
    return handleApiError(error);
  }
}
