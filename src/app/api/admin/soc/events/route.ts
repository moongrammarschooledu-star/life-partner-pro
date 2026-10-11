import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { prisma } from "@/lib/prisma";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { assertSocEnabled } from "@/lib/soc/route-helpers";
import { logSocAccess } from "@/lib/soc/audit";
import { marketingError, noStore } from "@/lib/marketing/route-utils";

// Security events as COUNTS per type over a window. Individual events carry hashed identifiers and are never listed here; an alert's
// evidence points at them by id and is opened through the alert.
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("soc:events:view");
    await assertSocEnabled();
    const limited = await enforceConfiguredLimit(req, "soc-query", { limit: 600, windowMs: 3_600_000 }, admin.id);
    if (limited) return limited;
    const days = Math.min(Math.max(Number(new URL(req.url).searchParams.get("days") ?? 7) || 7, 1), 90);
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await prisma.securityEvent.groupBy({ by: ["eventType"], where: { createdAt: { gte: since } }, _count: { _all: true } });
    await logSocAccess({ adminId: admin.id, action: "VIEW", resource: "events" });
    return NextResponse.json({ days, since: since.toISOString(), source: "SecurityEvent", items: rows.map((r) => ({ eventType: r.eventType, count: r._count._all })).sort((a, b) => b.count - a.count) }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}
