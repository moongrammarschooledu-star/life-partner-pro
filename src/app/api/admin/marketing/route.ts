import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/route-guard";
import { computeMarketingAnalytics } from "@/lib/marketing/analytics";
import { listProviderStatuses } from "@/lib/marketing/provider-service";
import { dateRange, marketingError, noStore } from "@/lib/marketing/route-utils";
import { getAllFeatureFlags } from "@/lib/ops/feature-flags";

// Marketing Center overview. The analytics block is returned only to holders of marketing:analytics:view; the provider
// block only to marketing:providers:view. The server withholds what the caller may not see.
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("marketing:view");
    const can = (p: Parameters<typeof admin.permissions.includes>[0]) => admin.permissions.includes(p);
    const range = dateRange(req.url);
    const [flags, pendingCampaigns, pendingPages, pendingForms, pendingCreatives, analytics, providers, webhookIssues] = await Promise.all([
      getAllFeatureFlags(),
      prisma.marketingCampaign.count({ where: { status: "IN_REVIEW" } }),
      prisma.landingPageVersion.count({ where: { status: "REVIEW" } }),
      prisma.leadFormVersion.count({ where: { status: "REVIEW" } }),
      prisma.marketingCreative.count({ where: { status: "REVIEW" } }),
      can("marketing:analytics:view") ? computeMarketingAnalytics({ from: range.from, to: range.to }) : Promise.resolve(null),
      can("marketing:providers:view") ? listProviderStatuses() : Promise.resolve(null),
      can("marketing:providers:view") ? prisma.marketingWebhookEvent.count({ where: { status: { in: ["FAILED", "PENDING_FETCH", "REJECTED"] }, receivedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } } }) : Promise.resolve(null),
    ]);
    return NextResponse.json({
      flags: Object.fromEntries(Object.entries(flags).filter(([k]) => k.startsWith("marketing.") || k === "ai.marketing_assistant.enabled")),
      pendingApprovals: { campaigns: pendingCampaigns, landingPages: pendingPages, forms: pendingForms, creatives: pendingCreatives },
      analytics, providers, webhookIssuesLast7Days: webhookIssues,
    }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}
