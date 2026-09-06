import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";

// Spec §22 — structural only; no permission inheritance is wired (the spec
// itself hedges "permissions CAN be associated with departments").
export async function GET() {
  try {
    await requireAdmin("staff:view");
    const items = await prisma.department.findMany({ orderBy: { name: "asc" } });
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("admin:manage");
    const { name, description } = (await req.json()) as { name?: string; description?: string };
    if (!name?.trim()) throw new ApiError(400, "Name is required.");

    const department = await prisma.department.create({ data: { name: name.trim(), description: description || null } });
    await writeAudit({ action: "DEPARTMENT_CREATED", adminId: admin.id, meta: { departmentId: department.id, name: department.name } });

    return NextResponse.json(department);
  } catch (error) {
    return handleApiError(error);
  }
}
