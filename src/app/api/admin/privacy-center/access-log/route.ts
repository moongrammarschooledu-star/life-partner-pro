import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";

// Spec §30 — the Privacy Audit Log admin view.
export async function GET(req: Request) {
  try {
    await requireAdmin("privacy:view");
    const { searchParams } = new URL(req.url);
    const targetProfileId = searchParams.get("profileId");

    const items = await prisma.privacyAccessLog.findMany({
      where: targetProfileId ? { targetProfileId } : {},
      include: { actorAdmin: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}
