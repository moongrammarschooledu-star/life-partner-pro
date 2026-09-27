import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";

export async function GET(req: Request) {
  try {
    await requireAdmin("duplicates:view");
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");

    const items = await prisma.duplicateCandidate.findMany({
      where: status ? { status: status as never } : {},
      include: {
        profile: { select: { id: true, profileCode: true, fullName: true } },
        candidateProfile: { select: { id: true, profileCode: true, fullName: true } },
        reviewer: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}
