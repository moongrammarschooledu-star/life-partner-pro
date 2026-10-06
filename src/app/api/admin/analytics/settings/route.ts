import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { getAnalyticsSettings, updateAnalyticsSettings, activeEventsOf, ACTIVE_DEFINITION_TEXT } from "@/lib/analytics/settings";
import { marketingError, noStore, readBody, str } from "@/lib/marketing/route-utils";

export async function GET() {
  try {
    await requireAdmin("analytics:view");
    const s = await getAnalyticsSettings();
    return NextResponse.json({ timezone: s.timezone, minGroupSize: s.minGroupSize, freshnessSlaHours: s.freshnessSlaHours, activeEvents: activeEventsOf(s), activeDefinition: ACTIVE_DEFINITION_TEXT }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin("analytics:manage");
    const { reason, ...patch } = await readBody(req);
    const s = await updateAnalyticsSettings(admin.id, patch, str({ reason }, "reason", { required: true, max: 300 }));
    return NextResponse.json({ timezone: s.timezone, minGroupSize: s.minGroupSize, freshnessSlaHours: s.freshnessSlaHours, activeEvents: activeEventsOf(s) });
  } catch (error) {
    return marketingError(error);
  }
}
