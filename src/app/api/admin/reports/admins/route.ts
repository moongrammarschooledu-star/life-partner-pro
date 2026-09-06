import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { prisma } from "@/lib/prisma";

// A minimal, safe admin list (id + name only, no email/role) for the
// Reports filter bar's "Staff / Admin" dropdown — every role with
// reports:view needs this, but the full admin-users list requires
// admin:manage (SUPER_ADMIN only), which would otherwise block everyone
// else from filtering by staff.
export async function GET() {
  try {
    await requireAdmin("reports:view");
    const admins = await prisma.adminUser.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return NextResponse.json({ items: admins });
  } catch (error) {
    return handleApiError(error);
  }
}
