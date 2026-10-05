import { NextResponse } from "next/server";
import { AuditAction } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/route-guard";
import { marketingError, noStore, pageParams } from "@/lib/marketing/route-utils";

const ENGAGEMENT_ACTIONS = Object.values(AuditAction).filter((a) => a.startsWith("ENGAGEMENT_"));

export async function GET(req: Request) {
  try {
    await requireAdmin("engagement:audit:view");
    const { cursor, take } = pageParams(req.url);
    const rows = await prisma.auditLog.findMany({ where: { action: { in: ENGAGEMENT_ACTIONS } }, orderBy: { id: "desc" }, take: take + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    const page = rows.slice(0, take);
    return NextResponse.json({ items: page.map((r) => ({ id: r.id, action: r.action, adminId: r.adminId, targetProfileId: r.targetProfileId, meta: r.meta, createdAt: r.createdAt })), nextCursor: rows.length > take ? page[page.length - 1].id : null }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}
