import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { cancelCampaign } from "@/lib/communications/campaign-service";
import { readJson, str } from "@/lib/communications/route-utils";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("communications:campaigns:manage");
    const { id } = await params;
    const body = await readJson(req);
    return NextResponse.json(await cancelCampaign(admin, id, str(body.reason, "reason", { max: 300 })));
  } catch (error) {
    return handleApiError(error);
  }
}
