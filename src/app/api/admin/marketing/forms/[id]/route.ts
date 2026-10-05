import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/route-guard";
import { HttpError } from "@/lib/http-error";
import { saveFormDraft } from "@/lib/marketing/form-service";
import { marketingError, noStore, readBody, str } from "@/lib/marketing/route-utils";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("marketing:forms:view");
    const { id } = await params;
    const form = await prisma.leadForm.findUnique({ where: { id }, include: { versions: { orderBy: { version: "desc" }, take: 50 } } });
    if (!form) throw new HttpError(404, "Form not found.");
    return NextResponse.json(form, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("marketing:forms:create");
    const { id } = await params;
    const b = await readBody(req);
    const v = await saveFormDraft(admin, id, { fields: b.fields, consentConfig: b.consentConfig, privacyNoticeVersionId: str(b, "privacyNoticeVersionId", { required: true, max: 60 }), changeSummary: str(b, "changeSummary", { max: 300 }) || null });
    return NextResponse.json(v);
  } catch (error) {
    return marketingError(error);
  }
}
