import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/route-guard";
import { createLandingPage } from "@/lib/marketing/landing-service";
import { marketingError, noStore, pageParams, readBody, str } from "@/lib/marketing/route-utils";

export async function GET(req: Request) {
  try {
    await requireAdmin("marketing:landing_pages:view");
    const { cursor, take } = pageParams(req.url);
    const rows = await prisma.landingPage.findMany({
      orderBy: { id: "desc" }, take: take + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { versions: { orderBy: { version: "desc" }, take: 1, select: { version: true, status: true, title: true } } },
    });
    const page = rows.slice(0, take);
    return NextResponse.json({ items: page.map((p) => ({ id: p.id, code: p.code, slug: p.slug, name: p.name, status: p.status, language: p.language, sitemapInclude: p.sitemapInclude, noindex: p.noindex, publishedVersionId: p.publishedVersionId, latestVersion: p.versions[0] ?? null, updatedAt: p.updatedAt })), nextCursor: rows.length > take ? page[page.length - 1].id : null }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("marketing:landing_pages:create");
    const b = await readBody(req);
    const created = await createLandingPage(admin, {
      name: str(b, "name", { required: true, max: 120 }), slug: str(b, "slug", { required: true, max: 60 }),
      language: b.language === "UR" ? "UR" : "EN", campaignId: (b.campaignId as string | null | undefined) ?? null,
      sitemapInclude: b.sitemapInclude === true, noindex: b.noindex !== false,
      title: str(b, "title", { required: true, max: 160 }), metaDescription: str(b, "metaDescription", { max: 300 }) || null,
      canonicalUrl: str(b, "canonicalUrl", { max: 300 }) || null, ogTitle: str(b, "ogTitle", { max: 160 }) || null, ogDescription: str(b, "ogDescription", { max: 300 }) || null,
      socialImageUrl: str(b, "socialImageUrl", { max: 300 }) || null, sections: b.sections, changeSummary: str(b, "changeSummary", { max: 300 }) || null,
    });
    return NextResponse.json({ id: created.id, code: created.code, slug: created.slug }, { status: 201 });
  } catch (error) {
    return marketingError(error);
  }
}
