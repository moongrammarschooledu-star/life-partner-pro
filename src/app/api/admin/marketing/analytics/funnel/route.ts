import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { computeMarketingAnalytics } from "@/lib/marketing/analytics";
import { dateRange, marketingError, noStore } from "@/lib/marketing/route-utils";

export async function GET(req: Request) {
  try {
    await requireAdmin("marketing:analytics:view");
    const range = dateRange(req.url);
    const a = await computeMarketingAnalytics({ from: range.from, to: range.to, campaignId: new URL(req.url).searchParams.get("campaignId") });
    return NextResponse.json({ range: a.range, funnel: a.funnel, leadsByDay: a.leadsByDay }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}
