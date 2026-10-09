import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { prisma } from "@/lib/prisma";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { assertSocEnabled } from "@/lib/soc/route-helpers";
import { logSocAccess, SOC_AUDIT_ACTIONS } from "@/lib/soc/audit";
import { marketingError, noStore } from "@/lib/marketing/route-utils";

// Who opened which security screen, and every change made in Security Operations. Neither list carries result data.
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("soc:audit:view");
    await assertSocEnabled();
    const limited = await enforceConfiguredLimit(req, "soc-query", { limit: 600, windowMs: 3_600_000 }, admin.id);
    if (limited) return limited;
    const [access, changes] = await Promise.all([
      prisma.socAccessLog.findMany({ orderBy: { createdAt: "desc" }, take: 100, select: { id: true, adminId: true, action: true, resource: true, resourceId: true, outcome: true, createdAt: true } }),
      prisma.auditLog.findMany({ where: { action: { in: SOC_AUDIT_ACTIONS } }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, action: true, adminId: true, createdAt: true } }),
    ]);
    await logSocAccess({ adminId: admin.id, action: "VIEW", resource: "audit" });
    return NextResponse.json({ access, changes }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}
