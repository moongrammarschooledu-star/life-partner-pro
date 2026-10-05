import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/route-guard";
import { createCreative } from "@/lib/marketing/creative-service";
import { marketingError, noStore, pageParams, readBody, str } from "@/lib/marketing/route-utils";

export async function GET(req: Request) {
  try {
    await requireAdmin("marketing:creatives:view");
    const { cursor, take } = pageParams(req.url);
    const campaignId = new URL(req.url).searchParams.get("campaignId");
    const rows = await prisma.marketingCreative.findMany({ where: campaignId ? { campaignId } : {}, orderBy: { id: "desc" }, take: take + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    const page = rows.slice(0, take);
    return NextResponse.json({ items: page, nextCursor: rows.length > take ? page[page.length - 1].id : null }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("marketing:creatives:create");
    const b = await readBody(req);
    const c = await createCreative(admin, {
      campaignId: (b.campaignId as string | null | undefined) ?? null, name: str(b, "name", { required: true, max: 120 }), headline: str(b, "headline", { required: true, max: 120 }),
      body: str(b, "body", { required: true, max: 600 }), description: str(b, "description", { max: 300 }) || null, ctaLabel: str(b, "ctaLabel", { required: true, max: 40 }),
      language: b.language === "UR" ? "UR" : "EN", assetKey: str(b, "assetKey", { max: 200 }) || null,
    });
    return NextResponse.json(c, { status: 201 });
  } catch (error) {
    return marketingError(error);
  }
}
