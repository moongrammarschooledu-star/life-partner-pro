import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { getEngagementOverview } from "@/lib/engagement/analytics";
import { getEngagementSettings } from "@/lib/engagement/settings";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { ENGAGEMENT_FLAGS } from "@/lib/engagement/constants";
import { marketingError, noStore } from "@/lib/marketing/route-utils";

// Aggregate engagement overview (counts only; no person-level data).
export async function GET(req: Request) {
  try {
    await requireAdmin("engagement:view");
    const days = Math.min(Math.max(Number(new URL(req.url).searchParams.get("days") ?? 30) || 30, 1), 365);
    const [overview, settings, flags] = await Promise.all([
      getEngagementOverview(days),
      getEngagementSettings(),
      Promise.all(Object.entries(ENGAGEMENT_FLAGS).map(async ([k, name]) => [k, await isFeatureEnabled(name)] as const)),
    ]);
    return NextResponse.json({ overview, settings, flags: Object.fromEntries(flags) }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}
