import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { assertCanSeeCrmRecord } from "@/lib/crm/access";
import { applyTag, removeTag } from "@/lib/crm/crm-record-service";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("crm:tags:view");
    const { id } = await params;
    const record = await prisma.crmRecord.findUnique({ where: { id } });
    if (!record) throw new ApiError(404, "CRM record not found.");
    assertCanSeeCrmRecord(admin, record);

    const tags = await prisma.crmRecordTag.findMany({ where: { crmRecordId: id }, include: { tag: true } });
    return NextResponse.json({ items: tags });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("crm:tags:manage");
    const { id } = await params;
    const body = (await req.json()) as { tagId?: string };
    if (!body.tagId) throw new ApiError(400, "tagId is required.");

    const record = await prisma.crmRecord.findUnique({ where: { id } });
    if (!record) throw new ApiError(404, "CRM record not found.");
    assertCanSeeCrmRecord(admin, record);

    const applied = await applyTag(id, body.tagId, admin.id);
    return NextResponse.json(applied, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("crm:tags:manage");
    const { id } = await params;
    const tagId = new URL(req.url).searchParams.get("tagId");
    if (!tagId) throw new ApiError(400, "tagId query parameter is required.");

    const record = await prisma.crmRecord.findUnique({ where: { id } });
    if (!record) throw new ApiError(404, "CRM record not found.");
    assertCanSeeCrmRecord(admin, record);

    await removeTag(id, tagId, admin.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
