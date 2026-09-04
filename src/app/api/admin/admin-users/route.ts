import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";

export async function GET() {
  try {
    await requireAdmin("admin:manage");

    const admins = await prisma.adminUser.findMany({
      select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    // Last login is derived from the audit log rather than stored on the
    // AdminUser row itself, since ADMIN_LOGIN events are already recorded there.
    const lastLogins = await prisma.auditLog.groupBy({
      by: ["adminId"],
      where: { action: "ADMIN_LOGIN", adminId: { in: admins.map((a) => a.id) } },
      _max: { createdAt: true },
    });
    const lastLoginMap = new Map(lastLogins.map((l) => [l.adminId, l._max.createdAt]));

    return NextResponse.json({
      items: admins.map((a) => ({ ...a, lastLogin: lastLoginMap.get(a.id) ?? null })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("admin:manage");
    const { name, email, password, role } = await req.json();

    if (!name || !email || !password) throw new ApiError(400, "Name, email, and password are required");
    if (password.length < 8) throw new ApiError(400, "Password must be at least 8 characters");

    const existing = await prisma.adminUser.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) throw new ApiError(409, "An admin with this email already exists");

    const passwordHash = await bcrypt.hash(password, 12);
    const created = await prisma.adminUser.create({
      data: { name, email: email.toLowerCase(), passwordHash, role: role ?? "STAFF" },
      select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
    });

    await writeAudit({ action: "ADMIN_USER_CREATED", adminId: admin.id, meta: { createdAdminId: created.id, email: created.email } });

    return NextResponse.json(created);
  } catch (error) {
    return handleApiError(error);
  }
}
