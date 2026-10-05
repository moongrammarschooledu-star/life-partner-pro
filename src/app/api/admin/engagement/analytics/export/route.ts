import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { prisma } from "@/lib/prisma";
import { engagementAudit } from "@/lib/engagement/audit";
import { marketingError } from "@/lib/marketing/route-utils";

// CSV of the DAILY SNAPSHOT counts only (date, metric, value). No person-level rows, no scores, no contact details.
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("engagement:analytics:export");
    const days = Math.min(Math.max(Number(new URL(req.url).searchParams.get("days") ?? 30) || 30, 1), 400);
    const rows = await prisma.engagementDailySnapshot.findMany({ where: { dimension: "ALL", date: { gte: new Date(Date.now() - days * 86_400_000) } }, orderBy: [{ date: "asc" }, { metric: "asc" }], take: 20_000 });
    const csv = ["date,metric,value", ...rows.map((r) => `${r.date.toISOString().slice(0, 10)},${r.metric},${r.value}`)].join("\n");
    await engagementAudit({ action: "ENGAGEMENT_EXPORT", actorId: admin.id, resource: "engagement_snapshot", resourceId: "export", extra: { rows: rows.length, days } });
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=engagement-daily.csv", "Cache-Control": "no-store" } });
  } catch (error) {
    return marketingError(error);
  }
}
