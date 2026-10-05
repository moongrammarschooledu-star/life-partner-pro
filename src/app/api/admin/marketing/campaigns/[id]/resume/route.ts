import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { resumeCampaign } from "@/lib/marketing/campaign-service";
import { toCampaignDto } from "@/lib/marketing/campaign-queries";
import { marketingError, readBody, str } from "@/lib/marketing/route-utils";

// Resume needs launch authority (it re-activates spending), not merely pause authority.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("marketing:launch");
    const { id } = await params;
    const body = await readBody(req);
    return NextResponse.json(toCampaignDto(await resumeCampaign(admin, id, str(body, "reason", { required: true, max: 500 })), admin.permissions));
  } catch (error) {
    return marketingError(error);
  }
}
