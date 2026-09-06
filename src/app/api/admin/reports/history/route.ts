import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { prisma } from "@/lib/prisma";

// Spec §24 — Report History. Never stores the exported file itself, only
// metadata (see prisma/schema.prisma's ReportExecution comment).
export async function GET(req: Request) {
  try {
    await requireAdmin("reports:view");
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
    const pageSize = 20;

    const [total, items] = await Promise.all([
      prisma.reportExecution.count(),
      prisma.reportExecution.findMany({
        include: { createdBy: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return NextResponse.json({ items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
  } catch (error) {
    return handleApiError(error);
  }
}
