import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { createContent, listContent } from "@/lib/engagement/content-service";
import { marketingError, noStore, readBody, str } from "@/lib/marketing/route-utils";

export async function GET(req: Request) {
  try {
    await requireAdmin("engagement:content:view");
    const status = new URL(req.url).searchParams.get("status") ?? undefined;
    const rows = await listContent({ status });
    return NextResponse.json({ items: rows.map((c) => ({ id: c.id, code: c.code, slug: c.slug, category: c.category, status: c.status, currentVersion: c.currentVersion, latestVersion: c.versions[0] ?? null, updatedAt: c.updatedAt })) }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("engagement:content:create");
    const b = await readBody(req, 200_000);
    const c = await createContent(admin, { slug: str(b, "slug", { required: true, max: 80 }), category: str(b, "category", { required: true, max: 40 }), title: str(b, "title", { required: true, max: 160 }), description: str(b, "description", { max: 300 }) || null, body: str(b, "body", { required: true, max: 20_000 }), language: str(b, "language", { max: 2 }) || "EN", authorName: str(b, "authorName", { max: 80 }) || null, imageUrl: str(b, "imageUrl", { max: 500 }) || null });
    return NextResponse.json({ id: c.id, code: c.code, slug: c.slug }, { status: 201 });
  } catch (error) {
    return marketingError(error);
  }
}
