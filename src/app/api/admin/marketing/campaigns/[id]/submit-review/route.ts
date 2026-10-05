import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { submitCampaignForReview } from "@/lib/marketing/campaign-service";
import { toCampaignDto } from "@/lib/marketing/campaign-queries";
import { marketingError } from "@/lib/marketing/route-utils";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("marketing:edit");
    const { id } = await params;
    return NextResponse.json(toCampaignDto(await submitCampaignForReview(admin, id), admin.permissions));
  } catch (error) {
    return marketingError(error);
  }
}
