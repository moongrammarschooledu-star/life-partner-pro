import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { takeParam } from "@/lib/documents/route-utils";

// Only authorized security/admin personnel reach quarantined files (spec §13) — never a normal reviewer.
export async function GET(req: Request) {
  try {
    await requireAdmin("documents:manage_providers");
    const q = new URL(req.url).searchParams;
    const items = await prisma.documentQuarantine.findMany({
      where: q.get("decision") ? { decision: q.get("decision") as never } : { decision: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: takeParam(q.get("take"), 100),
    });
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}
