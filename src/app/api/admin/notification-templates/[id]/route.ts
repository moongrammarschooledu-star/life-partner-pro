import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("notification:template:manage");
    const { id } = await params;
    const { name, subject, message, status, variables } = await req.json();

    const existing = await prisma.notificationTemplate.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "Not found");

    const template = await prisma.notificationTemplate.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(subject !== undefined ? { subject: subject || null } : {}),
        ...(message !== undefined ? { message } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(Array.isArray(variables) ? { variables } : {}),
        updatedById: admin.id,
      },
    });

    await writeAudit({ action: "NOTIFICATION_TEMPLATE_UPDATED", adminId: admin.id, meta: { templateId: id } });

    return NextResponse.json(template);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("notification:template:manage");
    const { id } = await params;

    await prisma.notificationTemplate.delete({ where: { id } });
    await writeAudit({ action: "NOTIFICATION_TEMPLATE_UPDATED", adminId: admin.id, meta: { templateId: id, deleted: true } });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
