import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { computeMarketingAnalytics } from "@/lib/marketing/analytics";
import { dateRange, marketingError, noStore } from "@/lib/marketing/route-utils";

export async function GET(req: Request) {
  try {
    await requireAdmin("marketing:analytics:view");
    const range = dateRange(req.url);
    const a = await computeMarketingAnalytics({ from: range.from, to: range.to });
    return NextResponse.json({ range: a.range, byChannel: a.byChannel, bySource: a.bySource }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}
