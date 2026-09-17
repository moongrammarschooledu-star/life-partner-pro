import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";

export async function GET(req: Request) {
  try {
    await requireAdmin("privacy:requests:view");
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");

    const items = await prisma.privacyRequest.findMany({
      where: status ? { status: status as never } : {},
      include: { profile: { select: { fullName: true, profileCode: true } } },
      orderBy: { submittedAt: "desc" },
      take: 100,
    });

    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}
