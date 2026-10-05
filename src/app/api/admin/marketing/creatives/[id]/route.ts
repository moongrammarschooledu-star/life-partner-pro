import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/route-guard";
import { HttpError } from "@/lib/http-error";
import { editCreative } from "@/lib/marketing/creative-service";
import { marketingError, noStore, readBody, str } from "@/lib/marketing/route-utils";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("marketing:creatives:view");
    const { id } = await params;
    const c = await prisma.marketingCreative.findUnique({ where: { id } });
    if (!c) throw new HttpError(404, "Creative not found.");
    return NextResponse.json(c, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("marketing:creatives:edit");
    const { id } = await params;
    const b = await readBody(req);
    return NextResponse.json(await editCreative(admin, id, {
      name: str(b, "name", { required: true, max: 120 }), headline: str(b, "headline", { required: true, max: 120 }), body: str(b, "body", { required: true, max: 600 }),
      description: str(b, "description", { max: 300 }) || null, ctaLabel: str(b, "ctaLabel", { required: true, max: 40 }), language: b.language === "UR" ? "UR" : "EN", assetKey: str(b, "assetKey", { max: 200 }) || null,
    }));
  } catch (error) {
    return marketingError(error);
  }
}
