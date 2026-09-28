import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { approveCampaign } from "@/lib/communications/campaign-service";

// The approver can never be the campaign's creator; marketing and large campaigns also go through the STEP 19 gate.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("communications:campaigns:approve");
    const { id } = await params;
    const result = await approveCampaign(admin, id);
    return NextResponse.json(result, { status: result.approvalRequired ? 202 : 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
