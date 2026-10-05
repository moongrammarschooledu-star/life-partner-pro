import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { changeCampaignBudget } from "@/lib/marketing/budget-service";
import { toCampaignDto } from "@/lib/marketing/campaign-queries";
import { int, marketingError, readBody, str } from "@/lib/marketing/route-utils";

// Budget changes are enforced server-side only. On a launched campaign an increase answers 202 until the STEP 19
// approval is granted; the same request is then repeated to apply it.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("marketing:budget:manage");
    const { id } = await params;
    const body = await readBody(req);
    const outcome = await changeCampaignBudget(admin, id, {
      newTotalMinor: int(body, "newTotalMinor") as number,
      newDailyMinor: body.newDailyMinor === undefined ? undefined : body.newDailyMinor === null ? null : (int(body, "newDailyMinor") as number),
      reason: str(body, "reason", { required: true, max: 500 }),
    });
    if (outcome.approvalRequired) return NextResponse.json({ approvalRequired: true, approvalCode: outcome.approvalCode, status: outcome.status }, { status: 202 });
    return NextResponse.json(toCampaignDto(outcome.campaign, admin.permissions));
  } catch (error) {
    return marketingError(error);
  }
}
