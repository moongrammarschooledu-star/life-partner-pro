import { NextResponse } from "next/server";
import { AuditAction } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/route-guard";
import { assertEnabled } from "@/lib/analytics/route-helpers";
import { marketingError, noStore, pageParams } from "@/lib/marketing/route-utils";

const ACTIONS = Object.values(AuditAction).filter((a) => a.startsWith("ANALYTICS_"));

// Two trails: changes (AuditLog) and reads (AnalyticsAccessLog: who looked at what; never the data).
export async function GET(req: Request) {
  try {
    await requireAdmin("analytics:audit:view");
    await assertEnabled();
    const { cursor, take } = pageParams(req.url);
    const kind = new URL(req.url).searchParams.get("kind") === "access" ? "access" : "changes";
    if (kind === "access") {
      const rows = await prisma.analyticsAccessLog.findMany({ orderBy: { id: "desc" }, take: take + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      const page = rows.slice(0, take);
      return NextResponse.json({ items: page.map((r) => ({ id: r.id, adminId: r.adminId, action: r.action, resource: r.resource, resourceId: r.resourceId, sensitive: r.sensitive, outcome: r.outcome, createdAt: r.createdAt })), nextCursor: rows.length > take ? page[page.length - 1].id : null }, { headers: noStore });
    }
    const rows = await prisma.auditLog.findMany({ where: { action: { in: ACTIONS } }, orderBy: { id: "desc" }, take: take + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    const page = rows.slice(0, take);
    return NextResponse.json({ items: page.map((r) => ({ id: r.id, action: r.action, adminId: r.adminId, meta: r.meta, createdAt: r.createdAt })), nextCursor: rows.length > take ? page[page.length - 1].id : null }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}
