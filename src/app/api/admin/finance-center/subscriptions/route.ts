import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";

export async function GET(req: Request) {
  try {
    await requireAdmin("finance:subscriptions:view");
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");

    const subscriptions = await prisma.subscription.findMany({
      where: status ? { status: status as never } : {},
      include: { profile: { select: { fullName: true, profileCode: true } }, package: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return NextResponse.json({ items: subscriptions });
  } catch (error) {
    return handleApiError(error);
  }
}
