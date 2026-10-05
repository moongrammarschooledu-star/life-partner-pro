import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { computeMarketingAnalytics } from "@/lib/marketing/analytics";
import { dateRange, marketingError, noStore } from "@/lib/marketing/route-utils";

// Full analytics bundle. Spend-derived figures need budget visibility; everything else is aggregate counts only.
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("marketing:analytics:view");
    const q = new URL(req.url).searchParams;
    const range = dateRange(req.url);
    const a = await computeMarketingAnalytics({ from: range.from, to: range.to, campaignId: q.get("campaignId") });
    const budgetVisible = admin.permissions.includes("marketing:budget:view");
    return NextResponse.json(budgetVisible ? a : { ...a, advertising: { ...a.advertising, spendMinor: null, cpcMinor: null, cpmMinor: null, cplMinor: null }, topCampaigns: a.topCampaigns.map((c) => ({ ...c, spendVerifiedMinor: 0, cplMinor: null })) }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}
