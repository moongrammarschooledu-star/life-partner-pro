import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("communication:add");
    const { id } = await params;
    const { done } = await req.json();

    const followUp = await prisma.followUp.update({
      where: { id },
      data: done
        ? { status: "COMPLETED", completedAt: new Date() }
        : { status: "PENDING", completedAt: null },
    });

    return NextResponse.json(followUp);
  } catch (error) {
    return handleApiError(error);
  }
}
