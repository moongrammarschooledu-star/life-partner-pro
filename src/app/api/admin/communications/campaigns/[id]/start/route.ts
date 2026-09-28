import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { startCampaign } from "@/lib/communications/campaign-service";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("communications:campaigns:manage");
    const { id } = await params;
    return NextResponse.json(await startCampaign(admin, id));
  } catch (error) {
    return handleApiError(error);
  }
}
