import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { runAnalyticsQuery } from "@/lib/analytics/query";
import { assertEnabled } from "@/lib/analytics/route-helpers";
import { marketingError, noStore, readBody } from "@/lib/marketing/route-utils";

// The one query endpoint: a closed JSON query over catalog metrics. No SQL, no table or column names are accepted anywhere.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("analytics:view");
    await assertEnabled();
    const limited = await enforceConfiguredLimit(req, "analytics-query", { limit: 600, windowMs: 3_600_000 }, admin.id);
    if (limited) return limited;
    return NextResponse.json(await runAnalyticsQuery(admin, await readBody(req, 20_000)), { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}
