import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { approveCampaign } from "@/lib/marketing/campaign-service";
import { toCampaignDto } from "@/lib/marketing/campaign-queries";
import { marketingError, readBody, str } from "@/lib/marketing/route-utils";

// The service refuses an approver who created or submitted the campaign, independently of any permission.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("marketing:approve");
    const { id } = await params;
    const body = await readBody(req);
    return NextResponse.json(toCampaignDto(await approveCampaign(admin, id, str(body, "note", { max: 500 }) || undefined), admin.permissions));
  } catch (error) {
    return marketingError(error);
  }
}
