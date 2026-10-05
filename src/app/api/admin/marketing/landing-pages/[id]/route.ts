import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/route-guard";
import { HttpError } from "@/lib/http-error";
import { saveLandingDraft } from "@/lib/marketing/landing-service";
import { marketingError, noStore, readBody, str } from "@/lib/marketing/route-utils";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("marketing:landing_pages:view");
    const { id } = await params;
    const page = await prisma.landingPage.findUnique({ where: { id }, include: { versions: { orderBy: { version: "desc" }, take: 50 } } });
    if (!page) throw new HttpError(404, "Landing page not found.");
    return NextResponse.json(page, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

// Saves the draft (edits a DRAFT/REJECTED version in place, or starts a new version from anything else).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("marketing:landing_pages:edit");
    const { id } = await params;
    const b = await readBody(req);
    const v = await saveLandingDraft(admin, id, {
      title: str(b, "title", { required: true, max: 160 }), metaDescription: str(b, "metaDescription", { max: 300 }) || null,
      canonicalUrl: str(b, "canonicalUrl", { max: 300 }) || null, ogTitle: str(b, "ogTitle", { max: 160 }) || null, ogDescription: str(b, "ogDescription", { max: 300 }) || null,
      socialImageUrl: str(b, "socialImageUrl", { max: 300 }) || null, sections: b.sections, changeSummary: str(b, "changeSummary", { max: 300 }) || null,
    });
    return NextResponse.json(v);
  } catch (error) {
    return marketingError(error);
  }
}
