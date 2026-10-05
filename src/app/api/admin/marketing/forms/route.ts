import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/route-guard";
import { createLeadForm } from "@/lib/marketing/form-service";
import { marketingError, noStore, pageParams, readBody, str } from "@/lib/marketing/route-utils";

export async function GET(req: Request) {
  try {
    await requireAdmin("marketing:forms:view");
    const { cursor, take } = pageParams(req.url);
    const rows = await prisma.leadForm.findMany({
      orderBy: { id: "desc" }, take: take + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { versions: { orderBy: { version: "desc" }, take: 1, select: { version: true, status: true } } },
    });
    const page = rows.slice(0, take);
    return NextResponse.json({ items: page.map((f) => ({ id: f.id, code: f.code, name: f.name, status: f.status, publishedVersionId: f.publishedVersionId, campaignId: f.campaignId, latestVersion: f.versions[0] ?? null, updatedAt: f.updatedAt })), nextCursor: rows.length > take ? page[page.length - 1].id : null }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("marketing:forms:create");
    const b = await readBody(req);
    const form = await createLeadForm(admin, {
      name: str(b, "name", { required: true, max: 120 }), campaignId: (b.campaignId as string | null | undefined) ?? null,
      fields: b.fields, consentConfig: b.consentConfig, privacyNoticeVersionId: str(b, "privacyNoticeVersionId", { required: true, max: 60 }),
      changeSummary: str(b, "changeSummary", { max: 300 }) || null,
    });
    return NextResponse.json({ id: form.id, code: form.code }, { status: 201 });
  } catch (error) {
    return marketingError(error);
  }
}
