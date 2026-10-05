import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { pauseCampaign } from "@/lib/marketing/campaign-service";
import { toCampaignDto } from "@/lib/marketing/campaign-queries";
import { marketingError, readBody, str } from "@/lib/marketing/route-utils";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("marketing:pause");
    const { id } = await params;
    const body = await readBody(req);
    return NextResponse.json(toCampaignDto(await pauseCampaign(admin, id, str(body, "reason", { required: true, max: 500 })), admin.permissions));
  } catch (error) {
    return marketingError(error);
  }
}
