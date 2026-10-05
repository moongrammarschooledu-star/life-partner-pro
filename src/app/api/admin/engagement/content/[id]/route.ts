import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { getContentDetail, saveContentDraft } from "@/lib/engagement/content-service";
import { marketingError, noStore, readBody, str } from "@/lib/marketing/route-utils";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("engagement:content:view");
    const { id } = await params;
    return NextResponse.json(await getContentDetail(id), { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("engagement:content:edit");
    const { id } = await params;
    const b = await readBody(req, 200_000);
    const v = await saveContentDraft(admin, id, { title: str(b, "title", { required: true, max: 160 }), description: str(b, "description", { max: 300 }) || null, body: str(b, "body", { required: true, max: 20_000 }), language: str(b, "language", { max: 2 }) || "EN", authorName: str(b, "authorName", { max: 80 }) || null, imageUrl: str(b, "imageUrl", { max: 500 }) || null });
    return NextResponse.json({ version: v.version, status: v.status });
  } catch (error) {
    return marketingError(error);
  }
}
