import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/route-guard";
import { marketingError, noStore } from "@/lib/marketing/route-utils";

// The provider-neutral hierarchy (ad campaign → ad set/group → ad) for one campaign, returned as a flat list with
// parentId so the UI can draw whichever shape the provider actually uses.
export async function GET(req: Request) {
  try {
    await requireAdmin("marketing:ads:view");
    const campaignId = new URL(req.url).searchParams.get("campaignId");
    const items = await prisma.marketingAdNode.findMany({ where: campaignId ? { campaignId } : {}, orderBy: [{ campaignId: "asc" }, { level: "asc" }], take: 500 });
    return NextResponse.json({ items }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}
