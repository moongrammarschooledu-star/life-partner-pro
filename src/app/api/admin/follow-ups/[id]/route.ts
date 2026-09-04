import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("communication:add");
    const { id } = await params;
    const { done, status, outcome } = await req.json();

    const data =
      status === "CANCELLED"
        ? { status: "CANCELLED" as const }
        : done
          ? { status: "COMPLETED" as const, completedAt: new Date(), outcome: outcome || undefined }
          : { status: "PENDING" as const, completedAt: null };

    const followUp = await prisma.followUp.update({ where: { id }, data });

    return NextResponse.json(followUp);
  } catch (error) {
    return handleApiError(error);
  }
}
