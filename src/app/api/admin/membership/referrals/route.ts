import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";

export async function GET(req: Request) {
  try {
    await requireAdmin("referrals:view");
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const where = status ? { status: status as never } : {};
    const items = await prisma.referral.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { events: { orderBy: { createdAt: "desc" }, take: 5 }, rewards: true },
    });
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}
