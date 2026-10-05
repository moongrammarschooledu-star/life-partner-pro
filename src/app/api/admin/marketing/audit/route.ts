import { NextResponse } from "next/server";
import { AuditAction } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/route-guard";
import { marketingError, noStore, pageParams } from "@/lib/marketing/route-utils";

const MARKETING_ACTIONS = Object.values(AuditAction).filter((a) => a.startsWith("MARKETING_"));

// Marketing slice of the audit log. Entries were scrubbed on write (no contact details/tokens/secrets in meta).
export async function GET(req: Request) {
  try {
    await requireAdmin("marketing:audit:view");
    const { cursor, take } = pageParams(req.url);
    const action = new URL(req.url).searchParams.get("action");
    const rows = await prisma.auditLog.findMany({
      where: { action: action && MARKETING_ACTIONS.includes(action as AuditAction) ? (action as AuditAction) : { in: MARKETING_ACTIONS } },
      orderBy: { id: "desc" }, take: take + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, action: true, adminId: true, meta: true, createdAt: true, correlationId: true },
    });
    const page = rows.slice(0, take);
    return NextResponse.json({ items: page, nextCursor: rows.length > take ? page[page.length - 1].id : null }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}
