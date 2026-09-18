import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("finance:packages:manage");
    const { id } = await params;
    const { active } = (await req.json()) as { active?: boolean };

    const updated = await prisma.bankAccount.update({ where: { id }, data: { ...(active !== undefined ? { active } : {}) } });
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("finance:packages:manage");
    const { id } = await params;
    await prisma.bankAccount.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
