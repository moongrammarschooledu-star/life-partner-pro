import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";

export async function GET(req: Request) {
  try {
    await requireAdmin("audit:view");
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
    const pageSize = 25;

    const [total, items] = await Promise.all([
      prisma.auditLog.count(),
      prisma.auditLog.findMany({
        include: {
          admin: { select: { name: true } },
          targetProfile: { select: { id: true, profileCode: true, fullName: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return NextResponse.json({ items, page, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
  } catch (error) {
    return handleApiError(error);
  }
}
