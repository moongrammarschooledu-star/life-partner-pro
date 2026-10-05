import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/route-guard";
import { createExperiment } from "@/lib/marketing/experiments";
import { int, marketingError, noStore, readBody, str } from "@/lib/marketing/route-utils";

export async function GET() {
  try {
    await requireAdmin("marketing:experiments:view");
    return NextResponse.json({ items: await prisma.marketingExperiment.findMany({ orderBy: { createdAt: "desc" }, take: 100 }) }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("marketing:experiments:manage");
    const b = await readBody(req);
    const exp = await createExperiment(admin, {
      name: str(b, "name", { required: true, max: 120 }), campaignId: (b.campaignId as string | null | undefined) ?? null, landingPageId: (b.landingPageId as string | null | undefined) ?? null,
      variants: b.variants, primaryMetric: str(b, "primaryMetric", { max: 40 }) || undefined, minSampleSize: int(b, "minSampleSize", false),
    });
    return NextResponse.json(exp, { status: 201 });
  } catch (error) {
    return marketingError(error);
  }
}
