import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { serializeDocument } from "@/lib/documents/serialize";
import { takeParam } from "@/lib/documents/route-utils";

export async function GET(req: Request) {
  try {
    await requireAdmin("documents:view");
    const q = new URL(req.url).searchParams;
    const withinDays = Math.min(Number(q.get("withinDays") ?? 30) || 30, 365);
    const items = await prisma.document.findMany({
      where: { expiresAt: { lte: new Date(Date.now() + withinDays * 86_400_000) }, softDeletedAt: null, status: { notIn: ["ARCHIVED", "DELETED"] } },
      orderBy: { expiresAt: "asc" },
      take: takeParam(q.get("take"), 100),
    });
    return NextResponse.json({ items: items.map(serializeDocument) });
  } catch (error) {
    return handleApiError(error);
  }
}
