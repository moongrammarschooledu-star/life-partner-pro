import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { launchCampaign } from "@/lib/marketing/campaign-service";
import { toCampaignDto } from "@/lib/marketing/campaign-queries";
import { marketingError, readBody, str } from "@/lib/marketing/route-utils";

// The only way a campaign becomes ACTIVE/SCHEDULED. launchCampaign re-runs every governance check and the STEP 19 gate;
// a pending approval answers 202 and nothing is launched until it is approved and this is called again.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("marketing:launch");
    const { id } = await params;
    const body = await readBody(req);
    const outcome = await launchCampaign(admin, id, str(body, "reason", { required: true, max: 500 }));
    if (outcome.approvalRequired) return NextResponse.json({ approvalRequired: true, approvalCode: outcome.approvalCode, status: outcome.status }, { status: 202 });
    return NextResponse.json(toCampaignDto(outcome.campaign, admin.permissions));
  } catch (error) {
    return marketingError(error);
  }
}
