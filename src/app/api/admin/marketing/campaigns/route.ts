import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { createCampaign, type CampaignInput } from "@/lib/marketing/campaign-service";
import { campaignInputFromBody } from "@/lib/marketing/campaign-input";
import { listCampaigns, toCampaignDto } from "@/lib/marketing/campaign-queries";
import { marketingError, noStore, pageParams, readBody } from "@/lib/marketing/route-utils";
import type { MarketingCampaignStatus } from "@prisma/client";

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("marketing:view");
    const { cursor, take } = pageParams(req.url);
    const status = new URL(req.url).searchParams.get("status") as MarketingCampaignStatus | null;
    return NextResponse.json(await listCampaigns(admin.permissions, { status: status ?? undefined, cursor, take }), { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("marketing:create");
    const body = campaignInputFromBody(await readBody(req));
    const campaign = await createCampaign(admin, body as CampaignInput);
    return NextResponse.json(toCampaignDto(campaign, admin.permissions), { status: 201 });
  } catch (error) {
    return marketingError(error);
  }
}
