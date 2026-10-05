import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { attributionSummary, computeCampaignRoi, computeMarketingAnalytics } from "@/lib/marketing/analytics";
import { dateRange, marketingError, noStore } from "@/lib/marketing/route-utils";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("marketing:analytics:view");
    const { id } = await params;
    const range = dateRange(req.url, 90);
    const [analytics, attribution, roi] = await Promise.all([
      computeMarketingAnalytics({ from: range.from, to: range.to, campaignId: id }),
      attributionSummary(id),
      computeCampaignRoi(id),
    ]);
    // Spend-derived figures are withheld without budget visibility.
    const budgetVisible = admin.permissions.includes("marketing:budget:view");
    return NextResponse.json({ analytics: budgetVisible ? analytics : { ...analytics, advertising: { ...analytics.advertising, spendMinor: null, cpcMinor: null, cpmMinor: null, cplMinor: null } }, attribution, roi: budgetVisible ? roi : { status: "INSUFFICIENT_DATA", message: "Insufficient verified data for ROI calculation." } }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}
