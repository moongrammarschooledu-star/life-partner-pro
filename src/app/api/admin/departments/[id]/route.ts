import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("admin:manage");
    const { id } = await params;
    const { name, description, active } = (await req.json()) as { name?: string; description?: string; active?: boolean };

    const department = await prisma.department.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(description !== undefined ? { description: description || null } : {}),
        ...(active !== undefined ? { active } : {}),
      },
    });

    await writeAudit({ action: "DEPARTMENT_UPDATED", adminId: admin.id, meta: { departmentId: id } });

    return NextResponse.json(department);
  } catch (error) {
    return handleApiError(error);
  }
}
