import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { assertCanSeeCrmRecord } from "@/lib/crm/access";
import { hasBroadRecordAccess } from "@/lib/permissions";
import { editCrmNote, deleteCrmNote } from "@/lib/crm/crm-record-service";

// Only the note's own author, or an admin with broad record access, may
// edit/delete it — the same authorship-or-manager pattern this codebase
// already uses for the graded note-visibility ranks in case-access.ts.
async function assertNoteEditable(admin: Awaited<ReturnType<typeof requireAdmin>>, crmRecordId: string, noteId: string) {
  const record = await prisma.crmRecord.findUnique({ where: { id: crmRecordId } });
  if (!record) throw new ApiError(404, "CRM record not found.");
  assertCanSeeCrmRecord(admin, record);

  const note = await prisma.crmNote.findUnique({ where: { id: noteId } });
  if (!note || note.crmRecordId !== crmRecordId || note.deletedAt) throw new ApiError(404, "Note not found.");
  if (note.authorId !== admin.id && !hasBroadRecordAccess(admin.role)) {
    throw new ApiError(403, "Only the note's author or a manager can modify it.");
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; noteId: string }> }) {
  try {
    const admin = await requireAdmin("crm:notes:edit");
    const { id, noteId } = await params;
    const body = (await req.json()) as { body?: string };
    if (!body.body?.trim()) throw new ApiError(400, "Note text is required.");

    await assertNoteEditable(admin, id, noteId);
    const updated = await editCrmNote(noteId, admin.id, body.body);
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; noteId: string }> }) {
  try {
    const admin = await requireAdmin("crm:notes:delete");
    const { id, noteId } = await params;

    await assertNoteEditable(admin, id, noteId);
    const updated = await deleteCrmNote(noteId, admin.id);
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
