import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";

// Every generated Match is persisted — this lists that audit trail (spec §32).
export async function GET(req: Request) {
  try {
    await requireAdmin("match:run");
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");

    const matches = await prisma.match.findMany({
      where: status ? { status: status as never } : {},
      include: {
        profileA: { select: { id: true, profileCode: true, fullName: true, gender: true } },
        profileB: { select: { id: true, profileCode: true, fullName: true, gender: true } },
        createdBy: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return NextResponse.json({ items: matches });
  } catch (error) {
    return handleApiError(error);
  }
}
