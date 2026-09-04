import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("profile:view");
    const { id } = await params;
    const { resolved } = await req.json();

    const updated = await prisma.supportMessage.update({ where: { id }, data: { resolved: !!resolved } });
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
