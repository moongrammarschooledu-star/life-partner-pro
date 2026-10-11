import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { assertSocEnabled } from "@/lib/soc/route-helpers";
import { logSocAccess } from "@/lib/soc/audit";
import { listAlerts } from "@/lib/soc/alerts";
import { marketingError, noStore } from "@/lib/marketing/route-utils";
import type { SocAlertStatus, SocSeverity } from "@prisma/client";

const STATUSES = ["OPEN", "NEW", "ACKNOWLEDGED", "INVESTIGATING", "RESOLVED", "FALSE_POSITIVE", "ESCALATED", "CLOSED"];
const SEVERITIES = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"];

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("soc:alerts:view");
    await assertSocEnabled();
    const limited = await enforceConfiguredLimit(req, "soc-query", { limit: 600, windowMs: 3_600_000 }, admin.id);
    if (limited) return limited;
    const q = new URL(req.url).searchParams;
    const status = q.get("status") ?? "OPEN";
    const severity = q.get("severity");
    const items = await listAlerts({
      status: STATUSES.includes(status) ? (status as SocAlertStatus | "OPEN") : "OPEN",
      severity: severity && SEVERITIES.includes(severity) ? (severity as SocSeverity) : undefined,
      ruleKey: q.get("rule")?.slice(0, 80) || undefined,
      take: Math.min(Number(q.get("take") ?? 100) || 100, 300),
    });
    await logSocAccess({ adminId: admin.id, action: "VIEW", resource: "alerts" });
    return NextResponse.json({ items }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}
