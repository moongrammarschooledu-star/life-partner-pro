import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { createAlertRule, listAlerts } from "@/lib/analytics/alerts";
import { assertEnabled } from "@/lib/analytics/route-helpers";
import { marketingError, noStore, readBody, str } from "@/lib/marketing/route-utils";

export async function GET() {
  try {
    await requireAdmin("analytics:alerts:view");
    await assertEnabled();
    return NextResponse.json(await listAlerts(), { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("analytics:alerts:manage");
    await assertEnabled("analytics.alerts.enabled");
    const b = await readBody(req);
    const row = await createAlertRule(admin, { name: str(b, "name", { required: true, max: 120 }), metricKey: str(b, "metricKey", { required: true, max: 80 }), operator: str(b, "operator", { required: true, max: 4 }), threshold: Number(b.threshold), windowHours: typeof b.windowHours === "number" ? b.windowHours : undefined, minSample: typeof b.minSample === "number" ? b.minSample : undefined, severity: str(b, "severity", { max: 10 }) || undefined, recipientAdminIds: Array.isArray(b.recipientAdminIds) ? (b.recipientAdminIds as unknown[]).filter((x): x is string => typeof x === "string") : [], cooldownMinutes: typeof b.cooldownMinutes === "number" ? b.cooldownMinutes : undefined });
    return NextResponse.json({ id: row.id }, { status: 201 });
  } catch (error) {
    return marketingError(error);
  }
}
