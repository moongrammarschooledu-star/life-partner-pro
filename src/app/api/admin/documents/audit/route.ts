import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { takeParam } from "@/lib/documents/route-utils";

// The document access audit trail (spec §22/§56) — a dedicated permission, separate from documents:view,
// since it can reveal WHO looked at something (a sensitive fact on its own).
export async function GET(req: Request) {
  try {
    await requireAdmin("documents:audit:view");
    const q = new URL(req.url).searchParams;
    const documentId = q.get("documentId");
    const items = await prisma.documentAccessLog.findMany({
      where: { ...(documentId ? { documentId } : {}), ...(q.get("action") ? { action: q.get("action") as never } : {}), ...(q.get("result") ? { result: q.get("result") as string } : {}) },
      orderBy: { createdAt: "desc" },
      take: takeParam(q.get("take"), 100),
    });
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}
