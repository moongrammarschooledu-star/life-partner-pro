import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { computeMarketingAnalytics } from "@/lib/marketing/analytics";
import { dateRange, marketingError, noStore } from "@/lib/marketing/route-utils";

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("marketing:analytics:view");
    const range = dateRange(req.url);
    const a = await computeMarketingAnalytics({ from: range.from, to: range.to });
    const budgetVisible = admin.permissions.includes("marketing:budget:view");
    return NextResponse.json({ range: a.range, campaigns: a.campaigns, topCampaigns: budgetVisible ? a.topCampaigns : a.topCampaigns.map((c) => ({ ...c, spendVerifiedMinor: 0, cplMinor: null })) }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}
