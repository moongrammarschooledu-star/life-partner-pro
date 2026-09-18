import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";

export async function GET() {
  try {
    await requireAdmin("finance:reconciliation:view");
    const runs = await prisma.reconciliationRun.findMany({
      include: { startedBy: { select: { name: true } }, items: { where: { status: { not: "MATCHED" } }, take: 20 } },
      orderBy: { startedAt: "desc" },
      take: 20,
    });
    return NextResponse.json({ items: runs });
  } catch (error) {
    return handleApiError(error);
  }
}
