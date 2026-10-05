import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { updateCampaign } from "@/lib/marketing/campaign-service";
import { campaignInputFromBody } from "@/lib/marketing/campaign-input";
import { getCampaignDetail, toCampaignDto } from "@/lib/marketing/campaign-queries";
import { marketingError, noStore, readBody } from "@/lib/marketing/route-utils";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("marketing:view");
    const { id } = await params;
    return NextResponse.json(await getCampaignDetail(id, admin.permissions), { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("marketing:edit");
    const { id } = await params;
    const patch = campaignInputFromBody(await readBody(req));
    const updated = await updateCampaign(admin, id, patch);
    return NextResponse.json(toCampaignDto(updated, admin.permissions));
  } catch (error) {
    return marketingError(error);
  }
}
