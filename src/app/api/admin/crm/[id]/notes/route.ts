import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { assertCanSeeCrmRecord, visibleNoteTiers } from "@/lib/crm/access";
import { addCrmNote, listCrmNotes } from "@/lib/crm/crm-record-service";
import type { CommunicationVisibility } from "@prisma/client";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("crm:notes:view");
    const { id } = await params;
    const record = await prisma.crmRecord.findUnique({ where: { id } });
    if (!record) throw new ApiError(404, "CRM record not found.");
    assertCanSeeCrmRecord(admin, record);

    const notes = await listCrmNotes(id, visibleNoteTiers(admin));
    return NextResponse.json({ items: notes });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("crm:notes:create");
    const { id } = await params;
    const body = (await req.json()) as { body?: string; visibility?: CommunicationVisibility };
    if (!body.body?.trim()) throw new ApiError(400, "Note text is required.");

    const record = await prisma.crmRecord.findUnique({ where: { id } });
    if (!record) throw new ApiError(404, "CRM record not found.");
    assertCanSeeCrmRecord(admin, record);

    if (body.visibility === "MANAGER_ONLY" && !visibleNoteTiers(admin).includes("MANAGER_ONLY")) {
      throw new ApiError(403, "You cannot author a manager-only note.");
    }

    const note = await addCrmNote(id, admin.id, body.body, body.visibility);
    return NextResponse.json(note, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
