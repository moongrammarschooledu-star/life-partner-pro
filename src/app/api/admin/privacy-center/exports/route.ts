import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";

export async function GET() {
  try {
    await requireAdmin("privacy:export:view");
    const items = await prisma.dataExportRequest.findMany({
      include: { profile: { select: { fullName: true, profileCode: true } } },
      orderBy: { requestedAt: "desc" },
      take: 100,
    });
    return NextResponse.json({
      items: items.map((r) => ({ id: r.id, profile: r.profile, format: r.format, status: r.status, requestedAt: r.requestedAt, expiresAt: r.expiresAt, downloadedAt: r.downloadedAt })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
